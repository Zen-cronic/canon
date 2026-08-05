#!/usr/bin/env python3
"""Load canon's demo catalog into a local DataHub OSS quickstart.

Reads ``fixtures/catalog.json`` — the same file the zero-credential demo runs
against — and emits it as real DataHub aspects through the Python SDK, so the
live run and the offline run are looking at the same 257 entities.

Emitted per dataset, all of them aspects DataHub ships with:

    datasetProperties          name, qualified name, description
    editableDatasetProperties  the human-written description, where there is one
    subTypes                   Table / View / Incremental Model / Snapshot / ...
    schemaMetadata             columns, native types, nullability, field terms
    ownership                  technical and business owners
    globalTags                 Production / Certified / PII / Deprecated
    glossaryTerms              Commerce.Order, Finance.Revenue, ...
    deprecation                only where the fixture already says so
    upstreamLineage            with the real edge type (TRANSFORMED / COPY / VIEW)
    siblings                   the dbt model and its warehouse materialisation
    datasetProfile             row and column counts (timeseries)
    datasetUsageStatistics     query counts and top users (timeseries)
    operation                  last-updated timestamp (timeseries)
    assertionInfo + assertionRunEvent   the freshness/volume/column tests

It also defines the four ``canon.*`` structured properties, because a structured
property has to exist before anything can set a value on it.

Usage:
    python bridge/ingest_catalog.py --gms http://localhost:8081
    python bridge/ingest_catalog.py --gms http://localhost:8081 --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable

# Upstream mcp-server-datahub #152: the telemetry ping is synchronous and on the
# request path. Set before importing anything from datahub.
os.environ.setdefault("DATAHUB_TELEMETRY_ENABLED", "false")

import datahub.metadata.schema_classes as models  # noqa: E402
from datahub.emitter.mcp import MetadataChangeProposalWrapper  # noqa: E402
from datahub.emitter.rest_emitter import DatahubRestEmitter  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CATALOG = REPO_ROOT / "fixtures" / "catalog.json"

# The properties canon writes its ruling into. Question-scoped: the value says
# what this asset is canonical FOR, so marking one asset never silently demotes
# another for a different question.
STRUCTURED_PROPERTIES = [
    (
        "canon.status",
        "canon status",
        "STRING",
        "Whether canon ruled this asset canonical for the subject in canon.subject.",
    ),
    (
        "canon.subject",
        "canon subject",
        "STRING",
        "The question this ruling answers, e.g. 'customer orders'. Scoping the claim to a question is what keeps it honest.",
    ),
    (
        "canon.decided_at",
        "canon decided at",
        "NUMBER",
        "Epoch millis when canon last ruled on this subject.",
    ),
    (
        "canon.rationale",
        "canon rationale",
        "STRING",
        "Why this asset won, in one paragraph, with the scores that decided it.",
    ),
    (
        "canon.superseded_by",
        "canon superseded by",
        "STRING",
        "URN of the asset that is canonical for this subject instead of this one.",
    ),
]

OWNERSHIP_TYPES = {
    "TECHNICAL_OWNER": "urn:li:ownershipType:__system__technical_owner",
    "BUSINESS_OWNER": "urn:li:ownershipType:__system__business_owner",
    "DATAOWNER": "urn:li:ownershipType:__system__data_steward",
}

SUBTYPE_FALLBACK = "Table"

ASSERTION_TYPE = {
    "FRESHNESS": models.AssertionTypeClass.FRESHNESS,
    "VOLUME": models.AssertionTypeClass.VOLUME,
    "COLUMN": models.AssertionTypeClass.FIELD,
    "SQL": models.AssertionTypeClass.DATASET,
}

RESULT_TYPE = {
    "SUCCESS": models.AssertionResultTypeClass.SUCCESS,
    "FAILURE": models.AssertionResultTypeClass.FAILURE,
    "ERROR": models.AssertionResultTypeClass.ERROR,
    "INIT": models.AssertionResultTypeClass.INIT,
}


def audit(ts: int) -> models.AuditStampClass:
    return models.AuditStampClass(time=ts, actor="urn:li:corpuser:canon")


def schema_field(field: dict[str, Any]) -> models.SchemaFieldClass:
    native = field.get("nativeDataType", "STRING")
    return models.SchemaFieldClass(
        fieldPath=field["fieldPath"],
        type=models.SchemaFieldDataTypeClass(type=_field_type(native)),
        nativeDataType=native,
        nullable=bool(field.get("nullable", True)),
        description=field.get("description"),
        glossaryTerms=(
            models.GlossaryTermsClass(
                terms=[models.GlossaryTermAssociationClass(urn=t) for t in field["glossaryTerms"]],
                auditStamp=audit(0),
            )
            if field.get("glossaryTerms")
            else None
        ),
        globalTags=(
            models.GlobalTagsClass(tags=[models.TagAssociationClass(tag=t) for t in field["tags"]])
            if field.get("tags")
            else None
        ),
    )


def _field_type(native: str) -> Any:
    n = native.lower()
    if any(k in n for k in ("int", "number", "numeric", "decimal", "float", "double", "bigint")):
        return models.NumberTypeClass()
    if any(k in n for k in ("timestamp", "datetime", "date", "time")):
        return models.DateTypeClass()
    if "bool" in n:
        return models.BooleanTypeClass()
    return models.StringTypeClass()


def dataset_mcps(entity: dict[str, Any], generated_at: int) -> Iterable[MetadataChangeProposalWrapper]:
    urn = entity["urn"]
    name = entity["name"]

    yield MetadataChangeProposalWrapper(
        entityUrn=urn,
        aspect=models.DatasetPropertiesClass(
            name=name.split(".")[-1],
            qualifiedName=entity.get("qualifiedName", name),
            description=entity.get("description"),
            customProperties={"canon.fixture": "true"},
        ),
    )

    # A curated description lives on editableDatasetProperties in DataHub — that
    # is exactly what distinguishes "a human wrote this" from "the crawler did",
    # and canon's docs.curated rule reads the distinction.
    if entity.get("descriptionIsCurated") and entity.get("description"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.EditableDatasetPropertiesClass(
                created=audit(generated_at),
                lastModified=audit(generated_at),
                description=entity["description"],
            ),
        )

    yield MetadataChangeProposalWrapper(
        entityUrn=urn,
        aspect=models.SubTypesClass(typeNames=[entity.get("subType") or SUBTYPE_FALLBACK]),
    )

    if entity.get("schema"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.SchemaMetadataClass(
                schemaName=name,
                platform=f"urn:li:dataPlatform:{entity['platform']}",
                version=0,
                hash="",
                platformSchema=models.OtherSchemaClass(rawSchema=""),
                fields=[schema_field(f) for f in entity["schema"]],
            ),
        )

    if entity.get("owners"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.OwnershipClass(
                owners=[
                    models.OwnerClass(
                        owner=o["owner"],
                        type=models.OwnershipTypeClass.CUSTOM,
                        typeUrn=OWNERSHIP_TYPES.get(o["type"], OWNERSHIP_TYPES["TECHNICAL_OWNER"]),
                    )
                    for o in entity["owners"]
                ],
                lastModified=audit(generated_at),
            ),
        )

    if entity.get("tags"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.GlobalTagsClass(tags=[models.TagAssociationClass(tag=t) for t in entity["tags"]]),
        )

    if entity.get("glossaryTerms"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.GlossaryTermsClass(
                terms=[models.GlossaryTermAssociationClass(urn=t) for t in entity["glossaryTerms"]],
                auditStamp=audit(generated_at),
            ),
        )

    dep = entity.get("deprecation")
    if dep and dep.get("deprecated"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.DeprecationClass(
                deprecated=True,
                note=dep.get("note") or "",
                actor=dep.get("actor") or "urn:li:corpuser:datahub",
                decommissionTime=dep.get("decommissionTime"),
            ),
        )

    if entity.get("upstreams"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.UpstreamLineageClass(
                upstreams=[
                    models.UpstreamClass(
                        dataset=u["dataset"],
                        type=getattr(
                            models.DatasetLineageTypeClass, u.get("type", "TRANSFORMED"), models.DatasetLineageTypeClass.TRANSFORMED
                        ),
                    )
                    for u in entity["upstreams"]
                ]
            ),
        )

    if entity.get("siblings"):
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.SiblingsClass(
                siblings=entity["siblings"],
                primary=bool(entity.get("siblingPrimary")),
            ),
        )

    profile = entity.get("profile")
    if profile:
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.DatasetProfileClass(
                timestampMillis=profile["timestampMillis"],
                rowCount=profile.get("rowCount"),
                columnCount=profile.get("columnCount"),
            ),
        )

    usage = entity.get("usage")
    if usage:
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.DatasetUsageStatisticsClass(
                timestampMillis=generated_at,
                eventGranularity=models.TimeWindowSizeClass(unit=models.CalendarIntervalClass.DAY, multiple=1),
                totalSqlQueries=usage.get("totalSqlQueries"),
                uniqueUserCount=usage.get("uniqueUserCount"),
                userCounts=[
                    models.DatasetUserUsageCountsClass(user=u, count=max(1, usage.get("totalSqlQueries", 0) // max(1, len(usage["topUsers"]))))
                    for u in usage.get("topUsers", [])
                ],
            ),
        )

    op = entity.get("operation")
    if op:
        yield MetadataChangeProposalWrapper(
            entityUrn=urn,
            aspect=models.OperationClass(
                timestampMillis=op["lastUpdatedTimestamp"],
                lastUpdatedTimestamp=op["lastUpdatedTimestamp"],
                operationType=getattr(
                    models.OperationTypeClass, op.get("operationType", "INSERT"), models.OperationTypeClass.INSERT
                ),
                actor="urn:li:corpuser:canon",
            ),
        )


def assertion_mcps(entity: dict[str, Any], generated_at: int) -> Iterable[MetadataChangeProposalWrapper]:
    """Assertions are their own entity type, linked to the dataset they test."""
    for a in entity.get("assertions") or []:
        a_urn = a["urn"]
        yield MetadataChangeProposalWrapper(
            entityUrn=a_urn,
            aspect=models.AssertionInfoClass(
                type=ASSERTION_TYPE.get(a["type"], models.AssertionTypeClass.DATASET),
                description=a.get("description"),
                datasetAssertion=models.DatasetAssertionInfoClass(
                    dataset=entity["urn"],
                    scope=models.DatasetAssertionScopeClass.DATASET_ROWS,
                    operator=models.AssertionStdOperatorClass._NATIVE_,
                ),
            ),
        )
        yield MetadataChangeProposalWrapper(
            entityUrn=a_urn,
            aspect=models.AssertionRunEventClass(
                timestampMillis=generated_at,
                runId=f"canon-fixture-{generated_at}",
                assertionUrn=a_urn,
                asserteeUrn=entity["urn"],
                status=models.AssertionRunStatusClass.COMPLETE,
                result=models.AssertionResultClass(
                    type=RESULT_TYPE.get(a.get("lastResult", "INIT"), models.AssertionResultTypeClass.INIT)
                ),
            ),
        )


def structured_property_mcps() -> Iterable[MetadataChangeProposalWrapper]:
    for qualified_name, display_name, value_type, description in STRUCTURED_PROPERTIES:
        yield MetadataChangeProposalWrapper(
            entityUrn=f"urn:li:structuredProperty:{qualified_name}",
            aspect=models.StructuredPropertyDefinitionClass(
                qualifiedName=qualified_name,
                displayName=display_name,
                valueType=f"urn:li:dataType:datahub.{'number' if value_type == 'NUMBER' else 'string'}",
                description=description,
                cardinality=models.PropertyCardinalityClass.SINGLE,
                entityTypes=["urn:li:entityType:datahub.dataset"],
            ),
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gms", default=os.environ.get("DATAHUB_GMS_URL", "http://localhost:8080"))
    parser.add_argument("--token", default=os.environ.get("DATAHUB_GMS_TOKEN") or None)
    parser.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    parser.add_argument("--dry-run", action="store_true", help="Count what would be emitted and exit.")
    args = parser.parse_args()

    catalog = json.loads(Path(args.catalog).read_text())
    entities = catalog["entities"]
    generated_at = int(catalog.get("generatedAt") or time.time() * 1000)

    mcps: list[MetadataChangeProposalWrapper] = list(structured_property_mcps())
    for entity in entities:
        mcps.extend(dataset_mcps(entity, generated_at))
        mcps.extend(assertion_mcps(entity, generated_at))

    print(f"catalog:   {args.catalog}")
    print(f"entities:  {len(entities)}")
    print(f"aspects:   {len(mcps)} metadata change proposals")
    if args.dry_run:
        print("dry run — nothing emitted")
        return 0

    emitter = DatahubRestEmitter(gms_server=args.gms, token=args.token)
    emitter.test_connection()
    print(f"gms:       {args.gms} (connected)")

    failures = 0
    started = time.time()
    for i, mcp in enumerate(mcps, 1):
        try:
            emitter.emit(mcp)
        except Exception as exc:  # noqa: BLE001 - report and continue; a partial catalog is still useful
            failures += 1
            if failures <= 10:
                print(f"  FAILED {mcp.entityUrn} [{type(mcp.aspect).__name__}]: {exc}", file=sys.stderr)
        if i % 250 == 0:
            print(f"  {i}/{len(mcps)} emitted ({time.time() - started:.0f}s)")

    print(f"done:      {len(mcps) - failures}/{len(mcps)} aspects emitted in {time.time() - started:.0f}s")
    if failures:
        print(f"failures:  {failures}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
