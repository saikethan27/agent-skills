"""
Mathematical Color Contrast & Readability Engine (WCAG 2.1/2.2 + APCA 0.98G)
===========================================================================

WCAG
----
Relative luminance and contrast ratio follow WCAG 2.1 exactly:

    linear(v) = v / 12.92                      when v <= 0.04045
    linear(v) = ((v + 0.055) / 1.055) ** 2.4    otherwise
    Y         = 0.2126 R + 0.7152 G + 0.0722 B
    ratio     = (max(Yfg, Ybg) + 0.05) / (min(Yfg, Ybg) + 0.05)

Compliance is decided from the FULL-PRECISION ratio (`ratio_exact`); only the
reported `ratio` is rounded for display. Thresholds: normal text AA 4.5,
normal text AAA 7, large text AA 3, large text AAA 4.5, UI component 3.

Behavioral change (documented): unparseable colors raise ValueError instead of
silently resolving to black, which previously produced meaningless ratios.

APCA
----
Implements the APCA-W3 0.98G reference equations (0.1.9-4g constant set):

    Ys    = 0.2126729 R^2.4 + 0.7151522 G^2.4 + 0.0721750 B^2.4
    Y     = Ys + (0.022 - Ys)^1.414              when Ys <= 0.022
    |Ybg - Ytxt| < 0.0005                         -> Lc = 0
    dark text on light bg (Lc > 0):
        SAPC = (Ybg^0.56 - Ytxt^0.57) * 1.14 ; Lc = (SAPC - 0.027) * 100 (SAPC < 0.1 -> 0)
    light text on dark bg (Lc < 0):
        SAPC = (Ybg^0.65 - Ytxt^0.62) * 1.14 ; Lc = (SAPC + 0.027) * 100 (SAPC > -0.1 -> 0)

There is no arbitrary output clamp; the natural extremes are about +106.04 and
-107.88 Lc. Reference vectors: #777777 on #ffffff = +71.1111 Lc,
#888888 on #777777 = -7.3202 Lc.
"""

import math
import re
from typing import Any, Dict, Tuple

APCA_ALGORITHM_VERSION = "APCA-W3 0.98G (0.1.9-4g constants)"

WCAG_THRESHOLDS = {
    "normal_text_aa": 4.5,
    "normal_text_aaa": 7.0,
    "large_text_aa": 3.0,
    "large_text_aaa": 4.5,
    "ui_component_aa": 3.0,
}

APCA_CONSTANTS = {
    "mainTRC": 2.4,
    "Rco": 0.2126729,
    "Gco": 0.7151522,
    "Bco": 0.0721750,
    "normBG": 0.56,
    "normTXT": 0.57,
    "revTXT": 0.62,
    "revBG": 0.65,
    "blkThrs": 0.022,
    "blkClmp": 1.414,
    "scaleBoW": 1.14,
    "scaleWoB": 1.14,
    "loBoWoffset": 0.027,
    "loWoBoffset": 0.027,
    "loClip": 0.1,
    "deltaYmin": 0.0005,
}

# ---------------------------------------------------------------------------
# Color parsing
# ---------------------------------------------------------------------------


def _hex_to_rgb(hex_val: str) -> Tuple[float, float, float]:
    if len(hex_val) in (3, 4):
        r = int(hex_val[0] * 2, 16) / 255.0
        g = int(hex_val[1] * 2, 16) / 255.0
        b = int(hex_val[2] * 2, 16) / 255.0
        return (r, g, b)
    if len(hex_val) in (6, 8):
        r = int(hex_val[0:2], 16) / 255.0
        g = int(hex_val[2:4], 16) / 255.0
        b = int(hex_val[4:6], 16) / 255.0
        return (r, g, b)
    raise ValueError(f"Unsupported hex color length: #{hex_val}")


def _oklch_to_srgb(lightness: float, chroma: float, hue_deg: float) -> Tuple[float, float, float]:
    """OKLCH -> sRGB 0-1 (clipped), using the original OKLab transform."""
    hue_rad = math.radians(hue_deg)
    a = chroma * math.cos(hue_rad)
    b = chroma * math.sin(hue_rad)

    l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
    m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
    s_ = lightness - 0.0894841775 * a - 1.2914855480 * b

    l3, m3, s3 = l_ ** 3, m_ ** 3, s_ ** 3

    linear = (
        4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
        -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
        -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3,
    )

    def encode(u: float) -> float:
        if u <= 0.0031308:
            return 12.92 * u
        return 1.055 * (u ** (1 / 2.4)) - 0.055

    return tuple(max(0.0, min(1.0, encode(channel))) for channel in linear)  # type: ignore[return-value]


def parse_color_to_rgb(color_str: str) -> Tuple[float, float, float]:
    """
    Parse a hex, rgb()/rgba(), or oklch() color into a normalized (0-1) RGB tuple.

    Raises ValueError for unsupported syntax (no silent black fallback).
    """
    if not isinstance(color_str, str):
        raise ValueError(f"Color must be a string, received {type(color_str).__name__}")

    text = color_str.strip().lower()
    if not text:
        raise ValueError("Color string must not be empty")

    hex_match = re.match(r"^#([0-9a-f]{3,8})$", text)
    if hex_match:
        return _hex_to_rgb(hex_match.group(1))

    rgb_match = re.match(
        r"^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)", text
    )
    if rgb_match:
        def channel(raw: str) -> float:
            if raw.endswith("%"):
                return max(0.0, min(1.0, float(raw[:-1]) / 100.0))
            return max(0.0, min(1.0, float(raw) / 255.0))

        return (channel(rgb_match.group(1)), channel(rgb_match.group(2)), channel(rgb_match.group(3)))

    oklch_match = re.match(r"^oklch\(\s*([\d.]+%?)\s*[,\s]+([\d.]+%?)\s*[,\s]+([\d.]+)", text)
    if oklch_match:
        lightness_raw = oklch_match.group(1)
        lightness = float(lightness_raw[:-1]) / 100.0 if lightness_raw.endswith("%") else float(lightness_raw)
        chroma_raw = oklch_match.group(2)
        chroma = float(chroma_raw[:-1]) / 100.0 if chroma_raw.endswith("%") else float(chroma_raw)
        hue = float(oklch_match.group(3)) % 360
        return _oklch_to_srgb(lightness, chroma, hue)

    raise ValueError(
        f"Unsupported color syntax: {color_str!r}. Supported: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba(), oklch()."
    )


# ---------------------------------------------------------------------------
# WCAG
# ---------------------------------------------------------------------------


def channel_to_linear(c: float) -> float:
    """Convert an sRGB channel (0-1) to linear light."""
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def calculate_relative_luminance(r: float, g: float, b: float) -> float:
    """WCAG 2.1 relative luminance."""
    return (
        0.2126 * channel_to_linear(r)
        + 0.7152 * channel_to_linear(g)
        + 0.0722 * channel_to_linear(b)
    )


def exact_contrast_ratio(y1: float, y2: float) -> float:
    lighter = max(y1, y2)
    darker = min(y1, y2)
    return (lighter + 0.05) / (darker + 0.05)


def classify_contrast(exact_ratio: float) -> Dict[str, Any]:
    """Classify a FULL-PRECISION ratio (never a rounded display value)."""
    normal_text_aa = exact_ratio >= WCAG_THRESHOLDS["normal_text_aa"]
    normal_text_aaa = exact_ratio >= WCAG_THRESHOLDS["normal_text_aaa"]
    large_text_aa = exact_ratio >= WCAG_THRESHOLDS["large_text_aa"]
    large_text_aaa = exact_ratio >= WCAG_THRESHOLDS["large_text_aaa"]
    ui_component_aa = exact_ratio >= WCAG_THRESHOLDS["ui_component_aa"]
    grade = (
        "AAA"
        if normal_text_aaa
        else "AA"
        if normal_text_aa
        else "AA Large"
        if large_text_aa
        else "Fail"
    )
    return {
        "normal_text_aa": normal_text_aa,
        "normal_text_aaa": normal_text_aaa,
        "large_text_aa": large_text_aa,
        "large_text_aaa": large_text_aaa,
        "ui_component_aa": ui_component_aa,
        "grade": grade,
        "thresholds": dict(WCAG_THRESHOLDS),
    }


# ---------------------------------------------------------------------------
# APCA 0.98G
# ---------------------------------------------------------------------------


def apca_soft_clamp_black(y: float) -> float:
    if y > APCA_CONSTANTS["blkThrs"]:
        return y
    return y + ((APCA_CONSTANTS["blkThrs"] - y) ** APCA_CONSTANTS["blkClmp"])


def apca_luminance(r: float, g: float, b: float) -> float:
    """APCA 0.98G luminance (Ys). NOT the WCAG relative luminance."""
    trc = APCA_CONSTANTS["mainTRC"]
    return (
        APCA_CONSTANTS["Rco"] * (r ** trc)
        + APCA_CONSTANTS["Gco"] * (g ** trc)
        + APCA_CONSTANTS["Bco"] * (b ** trc)
    )


def apca_contrast_lc(text_ys: float, bg_ys: float) -> float:
    """Signed APCA 0.98G Lc from APCA luminances. No output clamp."""
    txt_y = apca_soft_clamp_black(text_ys)
    bg_y = apca_soft_clamp_black(bg_ys)

    if abs(bg_y - txt_y) < APCA_CONSTANTS["deltaYmin"]:
        return 0.0

    if bg_y > txt_y:
        sapc = (
            (bg_y ** APCA_CONSTANTS["normBG"]) - (txt_y ** APCA_CONSTANTS["normTXT"])
        ) * APCA_CONSTANTS["scaleBoW"]
        if sapc < APCA_CONSTANTS["loClip"]:
            return 0.0
        return (sapc - APCA_CONSTANTS["loBoWoffset"]) * 100.0

    sapc = (
        (bg_y ** APCA_CONSTANTS["revBG"]) - (txt_y ** APCA_CONSTANTS["revTXT"])
    ) * APCA_CONSTANTS["scaleWoB"]
    if sapc > -APCA_CONSTANTS["loClip"]:
        return 0.0
    return (sapc + APCA_CONSTANTS["loWoBoffset"]) * 100.0


def calculate_apca_contrast(color1: str, color2: str) -> Dict[str, Any]:
    """APCA 0.98G contrast for a color pair (text, background)."""
    text_rgb = parse_color_to_rgb(color1)
    bg_rgb = parse_color_to_rgb(color2)
    text_ys = apca_luminance(*text_rgb)
    bg_ys = apca_luminance(*bg_rgb)
    lc_exact = apca_contrast_lc(text_ys, bg_ys)
    lc = round(lc_exact, 1)
    return {
        "text": color1,
        "background": color2,
        "lc": lc,
        "lc_exact": lc_exact,
        "abs": round(abs(lc), 1),
        "polarity": (
            "identical"
            if abs(apca_soft_clamp_black(bg_ys) - apca_soft_clamp_black(text_ys))
            < APCA_CONSTANTS["deltaYmin"]
            else "normal"
            if bg_ys > text_ys
            else "reverse"
        ),
        "ys": {"text": text_ys, "background": bg_ys},
        "algorithm": APCA_ALGORITHM_VERSION,
        "simplified_guidance": (
            "Body" if abs(lc) >= 60 else "Large" if abs(lc) >= 45 else "Fail"
        ),
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def calculate_contrast_ratio(color1: str, color2: str, include_apca: bool = True) -> Dict[str, Any]:
    """
    Full WCAG 2.1 contrast report between two colors.

    Raises ValueError when a color cannot be parsed.
    """
    rgb1 = parse_color_to_rgb(color1)
    rgb2 = parse_color_to_rgb(color2)

    lum1 = calculate_relative_luminance(*rgb1)
    lum2 = calculate_relative_luminance(*rgb2)

    exact_ratio = exact_contrast_ratio(lum1, lum2)
    wcag = classify_contrast(exact_ratio)

    result: Dict[str, Any] = {
        "foreground": color1,
        "background": color2,
        "ratio": round(exact_ratio, 2),
        "ratio_exact": exact_ratio,
        "luminance": {
            "foreground": round(lum1, 6),
            "background": round(lum2, 6),
        },
        "wcag": wcag,
        "policy": (
            "Compliance is decided from the full-precision ratio; only the "
            "reported 'ratio' is rounded to 2 decimals."
        ),
    }

    if include_apca:
        result["apca"] = calculate_apca_contrast(color1, color2)

    return result