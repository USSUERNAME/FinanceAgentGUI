from __future__ import annotations

import unittest

from broker_pdf_ocr import usable_report_text


class BrokerPdfOcrTests(unittest.TestCase):
    def test_bullet_only_font_map_failure_is_rejected(self) -> None:
        self.assertFalse(usable_report_text("•\n•\n→\n•"))

    def test_korean_research_text_is_accepted(self) -> None:
        text = (
            "삼성전자는 로봇 사업 조직을 신설하고 제조 현장 실증을 확대한다. "
            "관련 공급망의 수주와 매출 가시성을 후속 확인한다. "
        ) * 4
        self.assertTrue(usable_report_text(text))


if __name__ == "__main__":
    unittest.main()
