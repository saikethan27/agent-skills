"""
Unit tests for the Python Ink Verifier suite.

Covers the audited mathematical policies:
- WCAG classification from the FULL-PRECISION ratio (regression: #148700 on
  #000000 has an exact ratio of 4.4953 and must FAIL normal-text AA even though
  it displays as 4.50).
- APCA 0.98G reference conformance (tolerance 0.01 Lc).
- Strict color parsing (no silent black fallback).
"""

import os
import tempfile
import unittest

from python.ink_verifier.contrast import (
    APCA_ALGORITHM_VERSION,
    apca_contrast_lc,
    apca_luminance,
    apca_soft_clamp_black,
    calculate_contrast_ratio,
    classify_contrast,
    parse_color_to_rgb,
)
from python.ink_verifier.security_linter import SecurityLinter
from python.ink_verifier.visual_audit import VisualCraftAuditor
from python.ink_verifier.bidi_linter import BidiAlignmentAuditor
from python.ink_verifier.site_inspector import SiteStyleInspector
from python.ink_verifier.viewport_capture import (
    capture_all_viewports,
    capture_single_viewport,
)

APCA_TOLERANCE = 0.01


class TestContrastEngine(unittest.TestCase):
    def test_contrast_ratio_black_white(self):
        res = calculate_contrast_ratio("#ffffff", "#000000")
        self.assertEqual(res["ratio"], 21.0)
        self.assertAlmostEqual(res["ratio_exact"], 21.0, places=8)
        self.assertTrue(res["wcag"]["normal_text_aaa"])
        self.assertEqual(res["wcag"]["grade"], "AAA")

    def test_contrast_ratio_low(self):
        res = calculate_contrast_ratio("#777777", "#888888")
        self.assertLess(res["ratio"], 3.0)
        self.assertFalse(res["wcag"]["normal_text_aa"])
        self.assertFalse(res["wcag"]["large_text_aa"])

    def test_rounded_ratio_does_not_grant_a_false_aa_pass(self):
        """Regression: #148700 on #000000 is 4.4953 -> normal-text AA fails."""
        res = calculate_contrast_ratio("#148700", "#000000")
        self.assertAlmostEqual(res["ratio_exact"], 4.4953336599, places=8)
        self.assertEqual(res["ratio"], 4.5)
        self.assertFalse(res["wcag"]["normal_text_aa"])
        self.assertTrue(res["wcag"]["large_text_aa"])
        self.assertTrue(res["wcag"]["ui_component_aa"])
        self.assertFalse(res["wcag"]["large_text_aaa"])
        self.assertFalse(res["wcag"]["normal_text_aaa"])
        self.assertEqual(res["wcag"]["grade"], "AA Large")

    def test_threshold_boundaries_use_exact_comparison(self):
        self.assertFalse(classify_contrast(4.4999999)["normal_text_aa"])
        self.assertTrue(classify_contrast(4.5)["normal_text_aa"])
        self.assertTrue(classify_contrast(4.5)["large_text_aaa"])
        self.assertFalse(classify_contrast(4.4999999)["normal_text_aaa"])
        self.assertTrue(classify_contrast(7.0)["normal_text_aaa"])
        self.assertTrue(classify_contrast(3.0)["ui_component_aa"])
        self.assertFalse(classify_contrast(2.999)["ui_component_aa"])
        self.assertEqual(
            classify_contrast(4.5)["thresholds"],
            {
                "normal_text_aa": 4.5,
                "normal_text_aaa": 7.0,
                "large_text_aa": 3.0,
                "large_text_aaa": 4.5,
                "ui_component_aa": 3.0,
            },
        )

    def test_invalid_color_syntax_raises_instead_of_using_black(self):
        with self.assertRaises(ValueError):
            parse_color_to_rgb("not-a-color")
        with self.assertRaises(ValueError):
            parse_color_to_rgb("")
        with self.assertRaises(ValueError):
            calculate_contrast_ratio("rgb(broken)", "#ffffff")

    def test_supports_hex_rgb_and_oklch_syntax(self):
        self.assertEqual(parse_color_to_rgb("#fff"), (1.0, 1.0, 1.0))
        self.assertEqual(parse_color_to_rgb("#000000"), (0.0, 0.0, 0.0))
        rgb = parse_color_to_rgb("rgb(56 189 248)")
        self.assertAlmostEqual(rgb[0], 56 / 255, places=6)
        legacy = parse_color_to_rgb("rgba(255, 255, 255)")
        self.assertEqual(legacy, (1.0, 1.0, 1.0))
        oklch = parse_color_to_rgb("oklch(0.5 0 0)")
        for channel in oklch:
            self.assertAlmostEqual(channel, parse_color_to_rgb("#636363")[0], places=2)


class TestApcaEngine(unittest.TestCase):
    def test_reference_vectors(self):
        """APCA 0.98G reference vectors (documented tolerance 0.01 Lc)."""
        cases = [
            ("#777777", "#ffffff", 71.1111),
            ("#888888", "#777777", -7.3202),
            ("#ffffff", "#000000", -107.8847),
            ("#000000", "#ffffff", 106.0407),
        ]
        for fg, bg, expected in cases:
            res = calculate_contrast_ratio(fg, bg)["apca"]
            self.assertAlmostEqual(res["lc_exact"], expected, delta=APCA_TOLERANCE, msg=f"{fg} on {bg}")

    def test_algorithm_version_is_pinned(self):
        self.assertIn("0.98G", APCA_ALGORITHM_VERSION)
        res = calculate_contrast_ratio("#ffffff", "#000000")["apca"]
        self.assertIn("0.98G", res["algorithm"])

    def test_uses_apca_luminance_not_wcag_luminance(self):
        self.assertAlmostEqual(apca_luminance(1.0, 1.0, 1.0), 1.0000001, places=6)
        self.assertAlmostEqual(apca_luminance(0.5, 0.5, 0.5), 0.5 ** 2.4, places=6)

    def test_identical_and_near_identical_colors_are_zero(self):
        for hex_color in ("#38bdf8", "#000000", "#ffffff", "#777777"):
            self.assertEqual(calculate_contrast_ratio(hex_color, hex_color)["apca"]["lc"], 0.0)
        self.assertEqual(apca_contrast_lc(0.5, 0.5 + 0.0004), 0.0)
        near = calculate_contrast_ratio("#010101", "#020202")["apca"]
        self.assertLess(abs(near["abs"]), 0.05)

    def test_signed_polarities_and_near_black_soft_clamp(self):
        dark_mode = calculate_contrast_ratio("#f1f5f9", "#0e131f")["apca"]
        light_mode = calculate_contrast_ratio("#0e131f", "#f1f5f9")["apca"]
        self.assertLess(dark_mode["lc"], 0)
        self.assertGreater(light_mode["lc"], 0)
        self.assertNotEqual(abs(dark_mode["abs"]), abs(light_mode["abs"]))

        self.assertAlmostEqual(apca_soft_clamp_black(0.0), 0.022 ** 1.414, places=12)
        self.assertEqual(apca_soft_clamp_black(0.5), 0.5)
        near_black = calculate_contrast_ratio("#050505", "#000000")["apca"]
        self.assertLess(abs(near_black["abs"]), 20)

    def test_low_contrast_clipping(self):
        ys = apca_luminance(0.5, 0.5, 0.5)
        self.assertEqual(apca_contrast_lc(ys, ys + 0.0006), 0.0)

    def test_no_arbitrary_output_clamp(self):
        white_on_black = calculate_contrast_ratio("#ffffff", "#000000")["apca"]
        black_on_white = calculate_contrast_ratio("#000000", "#ffffff")["apca"]
        self.assertLess(white_on_black["lc_exact"], -107.8)
        self.assertGreater(black_on_white["lc_exact"], 106.0)


class TestInkVerifier(unittest.TestCase):
    def test_security_linter_catches_eval_and_innerhtml(self):
        linter = SecurityLinter()
        bad_code = """
        const data = getUserInput();
        element.innerHTML = data;
        eval("console.log('injected')");
        localStorage.setItem('token', 'xyz123');
        """
        report = linter.lint_content(bad_code)
        self.assertFalse(report["passed"])
        self.assertGreaterEqual(report["total_findings"], 3)
        rule_ids = [f["rule_id"] for f in report["findings"]]
        self.assertIn("SEC-DOM-001", rule_ids)
        self.assertIn("SEC-DOM-002", rule_ids)
        self.assertIn("SEC-AUTH-001", rule_ids)

    def test_visual_craft_detects_ai_slop(self):
        auditor = VisualCraftAuditor()
        slop_code = """
        <div class="card" style="background: linear-gradient(135deg, #6366f1, #a855f7); font-size: 16px;">
          <div><div class="btn">Click me</div></div>
        </div>
        """
        audit_res = auditor.audit(slop_code)
        self.assertLess(audit_res["craft_score"], 70)
        penalty_factors = [p["factor"] for p in audit_res["penalties"]]
        self.assertIn("Cliche AI Gradient", penalty_factors)

    def test_visual_craft_rewards_high_craft(self):
        auditor = VisualCraftAuditor()
        high_craft = """
        <header><nav></nav></header>
        <main>
          <section style="color: oklch(0.95 0.02 240); font-size: clamp(1rem, 2vw, 2.5rem); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);">
          </section>
        </main>
        <footer></footer>
        """
        audit_res = auditor.audit(high_craft)
        self.assertGreaterEqual(audit_res["craft_score"], 85)

    def test_bidi_linter_detects_physical_properties(self):
        auditor = BidiAlignmentAuditor()
        bad_css = """
        .card {
            margin-left: 20px;
            padding-right: 15px;
            text-align: left;
        }
        """
        res = auditor.audit(bad_css)
        self.assertGreaterEqual(res["total_findings"], 3)
        categories = [f["category"] for f in res["findings"]]
        self.assertIn("Non-Logical CSS Property", categories)

    def test_bidi_linter_approves_logical_arabic_css(self):
        auditor = BidiAlignmentAuditor()
        clean_arabic = """
        body {
            font-family: 'IBM Plex Sans Arabic', sans-serif;
            margin-inline: auto;
            padding-inline-start: 1.5rem;
            text-align: start;
        }
        """
        res = auditor.audit(clean_arabic)
        self.assertGreaterEqual(res["bidi_score"], 85)
        self.assertIn("S", [res["grade"], "A"])

    def test_site_inspector_extracts_palette_and_fonts(self):
        inspector = SiteStyleInspector()
        snippet = """
        <style>
          :root { --bg: #0b0f19; --accent: #38bdf8; }
          body { font-family: 'Cairo', 'Outfit', sans-serif; font-size: clamp(1rem, 2vw, 1.5rem); }
          .card { backdrop-filter: blur(12px); border-radius: 16px; }
        </style>
        """
        extracted = inspector.inspect_content(snippet)
        self.assertIn("#0b0f19", extracted["extractedPalette"]["hexColors"])
        self.assertIn("#38bdf8", extracted["extractedPalette"]["hexColors"])
        self.assertTrue(extracted["hasGlassmorphism"])
        self.assertTrue(extracted["extractedTypography"]["usesFluidClamp"])

    def test_viewport_capture_generates_all_three_aspects(self):
        """Structure-level capture test.

        Browser availability and browser startup timing are environment
        dependent, so this test forces the deterministic SVG fallback
        (INK_CAPTURE_SKIP_BROWSER=1) and asserts the contract: three viewport
        artifacts, the documented ids, and a non-empty file per viewport.
        """
        os.environ["INK_CAPTURE_SKIP_BROWSER"] = "1"
        try:
            html = "<html><body style='background:#0b0f19;color:#fff;'><h1>Ink Viewport Test</h1></body></html>"
            with tempfile.TemporaryDirectory() as out_dir:
                res = capture_all_viewports(html, output_dir=out_dir, title="Test Spec")
                self.assertEqual(len(res["snapshots"]), 3)
                ids = [s["viewport_id"] for s in res["snapshots"]]
                self.assertIn("desktop_16_9", ids)
                self.assertIn("vertical_9_16", ids)
                self.assertIn("mobile_view", ids)
                self.assertTrue(res["viewportQualityChecks"]["allThreeViewportsGenerated"])
                self.assertFalse(res["browserDetected"])
                for snapshot in res["snapshots"]:
                    self.assertTrue(os.path.exists(snapshot["filePath"]))
                    self.assertGreater(snapshot["fileSize"], 0)
                    self.assertIn(snapshot["format"], ("png", "svg"))
        finally:
            os.environ.pop("INK_CAPTURE_SKIP_BROWSER", None)

    def test_viewport_capture_falls_back_when_browser_is_skipped(self):
        """A missing browser must degrade to SVG fallbacks, never raise."""
        os.environ["INK_CAPTURE_SKIP_BROWSER"] = "1"
        try:
            with tempfile.TemporaryDirectory() as out_dir:
                res = capture_all_viewports("<h1>fallback</h1>", output_dir=out_dir)
                self.assertEqual(len(res["snapshots"]), 3)
                self.assertTrue(
                    all(s["capturedWithBrowser"] is False for s in res["snapshots"])
                )
                self.assertTrue(
                    all(s["filePath"].endswith(".svg") for s in res["snapshots"])
                )
        finally:
            os.environ.pop("INK_CAPTURE_SKIP_BROWSER", None)

    def test_capture_single_viewport_reports_timeout(self):
        """A browser that never returns must time out cleanly and leave no file."""
        out_file = os.path.join(tempfile.gettempdir(), "ink_timeout_probe.png")
        if os.path.exists(out_file):
            os.remove(out_file)
        ok = capture_single_viewport(
            browser_path="definitely-not-a-browser-binary",
            target_url="about:blank",
            output_path=out_file,
            width=100,
            height=100,
            timeout_seconds=1,
        )
        self.assertFalse(ok)
        self.assertFalse(os.path.exists(out_file))


if __name__ == "__main__":
    unittest.main()

