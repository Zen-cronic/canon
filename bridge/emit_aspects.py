#!/usr/bin/env python3
"""The two writes the OSS MCP server cannot do, done through the Python SDK.

canon performs every other write over the DataHub OSS MCP server
(``add_structured_properties``, ``save_document``). Two of its writes have no
OSS MCP tool at all, and rather than pretend otherwise this bridge does them
directly against GMS:

``deprecate``
    Sets the ``deprecation`` aspect. The ``set_deprecation`` MCP tool exists
    only in DataHub Cloud — run ``npm run mcp:probe`` against a local quickstart
    and it is not in the 18 tools the OSS server registers. The aspect itself is
    plain OSS metadata, so the SDK writes it.

``incident``
    Files a native DataHub Incident (``incidentInfo``) against the candidate
    assets and assigns it to the owners canon read off those assets. This is the
    ABSTAIN branch: when two definitions are both live, canon will not pick, and
    the unanswerable question goes back to the people who can answer it — inside
    DataHub, not in a Slack message nobody can audit later.

Both subcommands read their payload as JSON on stdin so the TypeScript side
stays the single source of truth for what to write.

Usage:
    echo '{"urn": "...", "note": "..."}' | python bridge/emit_aspects.py deprecate
    echo '{"title": "...", "entities": [...], "assignees": [...]}' \\
        | python bridge/emit_aspects.py incident
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any

os.environ.setdefault("DATAHUB_TELEMETRY_ENABLED", "false")

import datahub.metadata.schema_classes as models  # noqa: E402
from datahub.emitter.mcp import MetadataChangeProposalWrapper  # noqa: E402
from datahub.emitter.rest_emitter import DatahubRestEmitter  # noqa: E402

CANON_ACTOR = "urn:li:corpuser:canon"


def emitter(args: argparse.Namespace) -> DatahubRestEmitter:
    return DatahubRestEmitter(gms_server=args.gms, token=args.token)


def do_deprecate(payload: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    urn = payload["urn"]
    mcp = MetadataChangeProposalWrapper(
        entityUrn=urn,
        aspect=models.DeprecationClass(
            deprecated=bool(payload.get("deprecated", True)),
            note=payload.get("note", ""),
            actor=payload.get("actor", CANON_ACTOR),
            decommissionTime=payload.get("decommissionTime"),
        ),
    )
    if not args.dry_run:
        emitter(args).emit(mcp)
    return {
        "wrote": "deprecation",
        "urn": urn,
        "via": "python-sdk:DeprecationClass",
        "why_not_mcp": "set_deprecation is a DataHub Cloud tool; it is not registered by the OSS MCP server",
    }


def do_incident(payload: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    now = int(payload.get("at") or time.time() * 1000)
    incident_id = payload["id"]
    urn = f"urn:li:incident:{incident_id}"
    assignees = [
        models.IncidentAssigneeClass(actor=a, assignedAt=models.AuditStampClass(time=now, actor=CANON_ACTOR))
        for a in payload.get("assignees", [])
    ]

    mcp = MetadataChangeProposalWrapper(
        entityUrn=urn,
        aspect=models.IncidentInfoClass(
            type=models.IncidentTypeClass.CUSTOM,
            customType="Canonical source undecided",
            title=payload["title"],
            description=payload["description"],
            entities=payload["entities"],
            assignees=assignees or None,
            priority=payload.get("priority", 2),
            source=models.IncidentSourceClass(type=models.IncidentSourceTypeClass.MANUAL),
            status=models.IncidentStatusClass(
                state=models.IncidentStateClass.ACTIVE,
                stage=models.IncidentStageClass.TRIAGE,
                message="Filed by canon. Two live definitions; a human has to choose.",
                lastUpdated=models.AuditStampClass(time=now, actor=CANON_ACTOR),
            ),
            created=models.AuditStampClass(time=now, actor=CANON_ACTOR),
            startedAt=now,
        ),
    )
    if not args.dry_run:
        emitter(args).emit(mcp)
    return {
        "wrote": "incidentInfo",
        "urn": urn,
        "entities": payload["entities"],
        "assignees": payload.get("assignees", []),
        "via": "python-sdk:IncidentInfoClass",
        "why_not_mcp": "the OSS MCP server registers no incident tool (upstream requests #136/#143/#145/#151/#153)",
    }


HANDLERS = {"deprecate": do_deprecate, "incident": do_incident}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=sorted(HANDLERS), help="which aspect to write")
    parser.add_argument("--gms", default=os.environ.get("DATAHUB_GMS_URL", "http://localhost:8080"))
    parser.add_argument("--token", default=os.environ.get("DATAHUB_GMS_TOKEN") or None)
    parser.add_argument("--dry-run", action="store_true", help="Validate the payload without emitting.")
    args = parser.parse_args()

    raw = sys.stdin.read().strip()
    if not raw:
        print("no payload on stdin", file=sys.stderr)
        return 2

    try:
        result = HANDLERS[args.action](json.loads(raw), args)
    except Exception as exc:  # noqa: BLE001 - the caller needs the reason as JSON
        print(json.dumps({"error": str(exc), "action": args.action}), file=sys.stderr)
        return 1

    result["dryRun"] = bool(args.dry_run)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
