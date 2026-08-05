from __future__ import annotations

import unittest

from build_daily_snapshot import upcoming_events
from collect_official_market_calendar import (
    collect_official_calendar,
    normalize_event,
    parse_bea_schedule,
    parse_bls_schedule,
    parse_ics_events,
)


SAMPLE_ICS = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:cpi-2026-07
DTSTART;TZID=America/New_York:20260724T083000
SUMMARY:Consumer Price Index for June 2026
DESCRIPTION:Official release details at https://www.bls.gov/news.release/cpi.nr0.htm
END:VEVENT
BEGIN:VEVENT
UID:employment-2026-08
DTSTART:20260730T123000Z
SUMMARY:Employment Situation for July 2026
DESCRIPTION:Official release details are
 https://www.bls.gov/news.release/empsit.nr0.htm
END:VEVENT
BEGIN:VEVENT
UID:regional-2026-07
DTSTART;VALUE=DATE:20260725
SUMMARY:Regional and State Employment
END:VEVENT
BEGIN:VEVENT
UID:future-2026-09
DTSTART;TZID=America/New_York:20260901T100000
SUMMARY:Job Openings and Labor Turnover Survey
END:VEVENT
END:VCALENDAR
"""

SAMPLE_BEA_HTML = """
<table>
  <tr class="scheduled-releases-type-press">
    <td class="scheduled-date no-wrap"><div class="release-date">July 30</div>
      <small class="text-muted">8:30 AM</small></td>
    <td class="release-title views-field">GDP (Advance Estimate), 2nd Quarter 2026</td>
  </tr>
</table>
"""

SAMPLE_BLS_HTML = """
<table>
  <tr>
    <th>Date</th><th>Time</th><th>Release</th>
  </tr>
  <tr>
    <td>Friday, July 24, 2026</td>
    <td>08:30 AM</td>
    <td><a href="/news.release/cpi.nr0.htm">Consumer Price Index for June 2026</a></td>
  </tr>
  <tr>
    <td>Thursday, July 30, 2026</td>
    <td>08:30 AM</td>
    <td>Employment Situation for July 2026</td>
  </tr>
</table>
"""


def calendar_config() -> dict:
    return {
        "official_market_calendar": {
            "enabled": True,
            "lookahead_days": 7,
            "include_titles": ["Consumer Price Index", "Employment Situation"],
            "sources": [{
                "id": "bls_release_calendar",
                "publisher": "U.S. Bureau of Labor Statistics",
                "url": "https://www.bls.gov/schedule/news_release/bls.ics",
                "time_zone": "America/New_York",
            }],
        },
    }


class OfficialMarketCalendarTests(unittest.TestCase):
    def test_ics_parser_unfolds_lines_and_preserves_event_properties(self) -> None:
        events = parse_ics_events(SAMPLE_ICS)
        self.assertEqual(len(events), 4)
        description = events[1]["DESCRIPTION"]["value"]
        self.assertIn("https://www.bls.gov/news.release/empsit.nr0.htm", description)

    def test_normalize_event_keeps_primary_lineage_and_stable_id(self) -> None:
        raw = parse_ics_events(SAMPLE_ICS)[0]
        source = calendar_config()["official_market_calendar"]["sources"][0]
        first = normalize_event(raw, source)
        second = normalize_event(raw, source)
        self.assertIsNotNone(first)
        self.assertEqual(first["event_id"], second["event_id"])
        self.assertEqual(first["date"], "2026-07-24")
        self.assertEqual(first["time"], "08:30 ET")
        self.assertEqual(first["source_grade"], "A")
        self.assertTrue(first["primary_source_confirmed"])
        self.assertIsNone(first["consensus"])
        self.assertIn("QQQ", first["monitoring_assets"])

    def test_collection_filters_by_window_and_major_release_titles(self) -> None:
        payload = collect_official_calendar(
            "2026-07-23", calendar_config(), fetcher=lambda _url: SAMPLE_ICS,
        )
        self.assertEqual(payload["collection_status"], "complete")
        self.assertEqual(len(payload["events"]), 2)
        self.assertEqual(
            {item["title"] for item in payload["events"]},
            {
                "Consumer Price Index for June 2026",
                "Employment Situation for July 2026",
            },
        )
        self.assertTrue(all(item["consensus"] is None for item in payload["events"]))

    def test_bea_html_parser_extracts_official_release_schedule(self) -> None:
        source = {
            "id": "bea_release_calendar",
            "publisher": "U.S. Bureau of Economic Analysis",
            "url": "https://www.bea.gov/news/schedule",
            "time_zone": "America/New_York",
            "format": "bea_html",
        }
        events = parse_bea_schedule(SAMPLE_BEA_HTML, "2026-07-23", source)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["date"], "2026-07-30")
        self.assertEqual(events[0]["time"], "8:30 AM ET")
        self.assertEqual(events[0]["importance"], "high")
        self.assertEqual(events[0]["source_url"], "https://bea.gov/news/schedule")

    def test_bls_html_fallback_parser_extracts_official_release_schedule(self) -> None:
        source = calendar_config()["official_market_calendar"]["sources"][0]
        events = parse_bls_schedule(
            SAMPLE_BLS_HTML,
            source,
            "https://www.bls.gov/schedule/2026/07_sched_list.htm",
        )
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["date"], "2026-07-24")
        self.assertEqual(events[0]["time"], "08:30 AM ET")
        self.assertEqual(events[0]["schedule_origin"], "dynamic_official_calendar_fallback")

    def test_collection_uses_bls_html_when_ics_is_blocked(self) -> None:
        config = calendar_config()
        source = config["official_market_calendar"]["sources"][0]
        source["fallback_format"] = "bls_html"
        source["fallback_url_template"] = (
            "https://www.bls.gov/schedule/{year}/{month}_sched_list.htm"
        )

        def fetch(url: str) -> str:
            if url.endswith(".ics"):
                raise PermissionError("blocked")
            return SAMPLE_BLS_HTML

        payload = collect_official_calendar("2026-07-23", config, fetcher=fetch)
        self.assertEqual(payload["collection_status"], "complete")
        self.assertEqual(len(payload["events"]), 2)
        self.assertEqual(payload["sources"][0]["status"], "complete_fallback_html")
        self.assertEqual(payload["sources"][0]["primary_error_type"], "PermissionError")

    def test_collection_failure_is_nonfatal_and_requests_manual_fallback(self) -> None:
        def fail(_url: str) -> str:
            raise TimeoutError("no response")

        payload = collect_official_calendar("2026-07-23", calendar_config(), fetcher=fail)
        self.assertEqual(payload["collection_status"], "failed_fallback_manual")
        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["errors"], [{
            "source_id": "bls_release_calendar",
            "error_type": "TimeoutError",
        }])

    def test_snapshot_merge_prefers_official_event_and_keeps_unique_manual_event(self) -> None:
        official_payload = collect_official_calendar(
            "2026-07-23", calendar_config(), fetcher=lambda _url: SAMPLE_ICS,
        )
        config = {
            "market_calendar": [
                {
                    "date": "2026-07-24",
                    "time": "08:30 ET",
                    "title": "Consumer Price Index for June 2026",
                    "source": "manual duplicate",
                },
                {
                    "date": "2026-07-25",
                    "time": "After close",
                    "category": "earnings",
                    "title": "Example Corp earnings",
                    "source": "Example IR",
                },
            ],
        }
        events = upcoming_events("2026-07-23", config, official_payload)
        self.assertEqual(len(events), 3)
        cpi = next(item for item in events if item["title"].startswith("Consumer Price Index"))
        earnings = next(item for item in events if item["title"] == "Example Corp earnings")
        self.assertEqual(cpi["schedule_origin"], "dynamic_official_calendar")
        self.assertEqual(cpi["source"], "U.S. Bureau of Labor Statistics")
        self.assertEqual(earnings["schedule_origin"], "manual_calendar")


if __name__ == "__main__":
    unittest.main()
