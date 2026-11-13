/**
 * Post-fix audit probe for mcp-ink-design.
 * Run from the package root:  node docs/audit-2026-10-03/verify.mjs
 *
 * Verifies the CORRECTED behavior of every audited defect and writes:
 *   docs/audit-2026-10-03/mcp-tools-schema.json        (live tools/list snapshot)
 *   docs/audit-2026-10-03/verification-results-postfix.json
 *
 * The original 1.2.0 audit evidence is preserved untouched in
 * verification-results.json and report.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../dist/server.js';
import { PythonBridge } from '../../dist/integrations/python/python-bridge.js';
import { generatePalette, MOOD_PRESETS } from '../../dist/domain/design-tokens/palette-generator.js';
import {
  isInGamut,
  mapToGamut,
  roundOklchForCss,
  serializedChannelsInGamut,
  oklchToSrgb,
  GAMUT_JND
} from '../../dist/domain/design-tokens/gamut-mapper.js';
import {
  calculateContrastRatio,
  classifyContrastRatio,
  WCAG_THRESHOLDS
} from '../../dist/domain/design-tokens/color-math.js';
import { apcaForHexPair, APCA_ALGORITHM_VERSION } from '../../dist/domain/design-tokens/apca.js';
import { tokensTool } from '../../dist/tools/tokens.tool.js';
import { spacingTool } from '../../dist/tools/spacing.tool.js';
import { gradientTool } from '../../dist/tools/gradient.tool.js';
import { fluidTool } from '../../dist/tools/fluid.tool.js';
import { validateTool } from '../../dist/tools/validate.tool.js';
import { captureTool } from '../../dist/tools/capture.tool.js';
import { pythonRunnerTool } from '../../dist/tools/python-runner.tool.js';
import { generateFluidClamp, fluidClampErrorPx, CLAMP_ENDPOINT_TOLERANCE_PX } from '../../dist/domain/design-tokens/typography-generator.js';
import { generateSpacingScale } from '../../dist/domain/design-tokens/spacing-scale.js';

const outDir = path.resolve('docs/audit-2026-10-03');
await fs.mkdir(outDir, { recursive: true });
const findings = { verifiedAt: new Date().toISOString(), apcaAlgorithm: APCA_ALGORITHM_VERSION };

// ---------------------------------------------------------------------------
// 1. MCP protocol surface over the packaged stdio executable
// ---------------------------------------------------------------------------
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.resolve('bin/mcp-ink-design.js')],
  stderr: 'pipe'
});
const client = new Client({ name: 'design-system-postfix-audit', version: '1.0.0' });
await client.connect(transport);
const listed = await client.listTools();
assert.equal(listed.tools.length, 14, 'expected 14 tools after the fluid-scale tool was added');
await fs.writeFile(path.join(outDir, 'mcp-tools-schema.json'), JSON.stringify(listed, null, 2) + '\n');

findings.protocol = {
  serverInfo: client.getServerVersion(),
  toolCount: listed.tools.length,
  tools: listed.tools.map(t => ({
    name: t.name,
    requiredInputs: t.inputSchema.required ?? [],
    inputProperties: Object.keys(t.inputSchema.properties ?? {}).length,
    hasOutputSchema: !!t.outputSchema,
    annotations: t.annotations
  }))
};

const success = await client.callTool({ name: 'ink_generate_spacing_scale', arguments: { basePx: 16, ratio: 1.5, fluid: true } });
findings.protocol.validCall = {
  isError: success.isError ?? false,
  hasStructuredContent: !!success.structuredContent,
  textMatchesStructured: JSON.stringify(JSON.parse(success.content[0].text)) === JSON.stringify(success.structuredContent)
};

const invalidCases = {
  fractionalGradientSteps: await client.callTool({ name: 'ink_generate_gradient', arguments: { fromOklch: { l: 0.5, c: 0.1, h: 0 }, toOklch: { l: 0.5, c: 0.1, h: 90 }, steps: 2.9 } }),
  equalViewports: await client.callTool({ name: 'ink_generate_spacing_scale', arguments: { fluid: true, minVw: 800, maxVw: 800 } }),
  reversedViewports: await client.callTool({ name: 'ink_generate_spacing_scale', arguments: { fluid: true, minVw: 1440, maxVw: 360 } }),
  zeroRatio: await client.callTool({ name: 'ink_generate_spacing_scale', arguments: { ratio: 0 } }),
  negativeBase: await client.callTool({ name: 'ink_generate_spacing_scale', arguments: { basePx: -16 } }),
  negativeFluidFactor: await client.callTool({ name: 'ink_generate_fluid_scale', arguments: { minSizePx: 16, maxSizePx: 32, minViewportPx: 800, maxViewportPx: 800 } })
};
findings.protocol.invalidInput = Object.fromEntries(
  Object.entries(invalidCases).map(([name, result]) => [name, { isError: !!result.isError, message: result.content?.[0]?.text }])
);
await client.close();

// ---------------------------------------------------------------------------
// 2. WCAG: decisions from the full-precision ratio
// ---------------------------------------------------------------------------
const wcagProbes = ['#148700', '#ffffff', '#777777', '#148701', '#0a0a0a', '#595959'];
findings.wcag = {
  thresholds: WCAG_THRESHOLDS,
  rounding: 'decisions use ratioExact; the displayed ratio is rounded to 2 decimals',
  cases: wcagProbes.map(hex => {
    const result = calculateContrastRatio(hex, '#000000');
    return {
      foreground: hex,
      ratioExact: result.ratioExact,
      ratio: result.ratio,
      normalTextAA: result.normalTextAA,
      displayWouldSuggestAA: Number(result.ratioExact.toFixed(2)) >= 4.5,
      falsePositive: result.normalTextAA !== (result.ratioExact >= 4.5)
    };
  }),
  boundaryClassification: {
    justBelow: classifyContrastRatio(4.4999999),
    exactThreshold: classifyContrastRatio(4.5),
    aaa: classifyContrastRatio(7)
  }
};
const roundingRegression = findings.wcag.cases.find(c => c.foreground === '#148700');
assert.equal(roundingRegression.normalTextAA, false, '#148700 on #000000 must fail normal-text AA');
assert.ok(Math.abs(roundingRegression.ratioExact - 4.4953336599) < 1e-8, 'exact ratio must be 4.4953336599');
assert.equal(roundingRegression.displayWouldSuggestAA, true, 'the rounded display value still reads 4.50');

// ---------------------------------------------------------------------------
// 3. APCA 0.98G reference conformance
// ---------------------------------------------------------------------------
const apcaVectors = [
  ['#777777', '#ffffff', 71.1111],
  ['#888888', '#777777', -7.3202],
  ['#ffffff', '#000000', -107.8847],
  ['#000000', '#ffffff', 106.0407],
  ['#000000', '#000000', 0],
  ['#010101', '#020202', 0],
  ['#050505', '#000000', null],
  ['#f1f5f9', '#0e131f', null]
];
findings.apca = {
  algorithm: APCA_ALGORITHM_VERSION,
  tolerance: 0.01,
  vectors: apcaVectors.map(([fg, bg, expected]) => {
    const result = apcaForHexPair(fg, bg);
    return {
      fg,
      bg,
      lcExact: result.lcExact,
      referenceLc: expected,
      delta: expected === null ? null : Math.abs(result.lcExact - expected),
      polarity: result.polarity,
      ok: expected === null ? null : Math.abs(result.lcExact - expected) <= 0.01
    };
  })
};
for (const vector of findings.apca.vectors) {
  if (vector.ok !== null) assert.equal(vector.ok, true, `APCA mismatch for ${vector.fg} on ${vector.bg}`);
}

// ---------------------------------------------------------------------------
// 4. Gamut mapping, P3 exports and contrast/export agreement
// ---------------------------------------------------------------------------
const p3Only = { l: 0.69, c: 0.26, h: 142 };
const outsideBoth = { l: 0.7, c: 0.25, h: 30 };
const srgbMappedP3 = mapToGamut(p3Only.l, p3Only.c, p3Only.h, 'p3');
const srgbOnlyMapped = mapToGamut(p3Only.l, p3Only.c, p3Only.h, 'srgb');
const naiveP3Hex = `#${[srgbMappedP3.channels.r, srgbMappedP3.channels.g, srgbMappedP3.channels.b]
  .map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0'))
  .join('')}`;

findings.gamut = {
  policy: {
    algorithm: 'CSS Color 4 binary search with local MINDE',
    jnd: GAMUT_JND,
    serializedChannelTolerance: 1 / 510
  },
  p3OnlyColor: {
    color: p3Only,
    inSrgb: isInGamut(p3Only.l, p3Only.c, p3Only.h, 'srgb'),
    inP3: isInGamut(p3Only.l, p3Only.c, p3Only.h, 'p3'),
    p3Export: { css: srgbMappedP3.css, hex: srgbMappedP3.hex, channels: srgbMappedP3.channels },
    srgbExport: { hex: srgbOnlyMapped.hex, chroma: srgbOnlyMapped.oklch.c },
    naiveP3ChannelsAsHex: naiveP3Hex,
    p3ChannelsNeverEncodedAsHex: srgbMappedP3.hex !== naiveP3Hex,
    hexEqualsIndependentSrgbMapping: srgbMappedP3.hex === mapToGamut(p3Only.l, p3Only.c, p3Only.h, 'srgb').hex
  },
  outsideBoth: {
    color: outsideBoth,
    inSrgb: isInGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, 'srgb'),
    inP3: isInGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, 'p3'),
    srgb: mapToGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, 'srgb'),
    p3: mapToGamut(outsideBoth.l, outsideBoth.c, outsideBoth.h, 'p3')
  },
  achromaticAndBoundaries: {
    achromaticSrgb: mapToGamut(0.5, 0, 45, 'srgb'),
    black: mapToGamut(0, 0.02, 45, 'srgb'),
    white: mapToGamut(1, 0.02, 45, 'p3')
  },
  serializationRounding: {
    requested: { l: 0.7, c: 0.4, h: 30 },
    rounded: roundOklchForCss(0.7, 0.4, 30, 'srgb'),
    serializedInGamut: serializedChannelsInGamut(
      oklchToSrgb(roundOklchForCss(0.7, 0.4, 30, 'srgb').l, roundOklchForCss(0.7, 0.4, 30, 'srgb').c, roundOklchForCss(0.7, 0.4, 30, 'srgb').h, 'srgb')
    )
  }
};
assert.equal(findings.gamut.p3OnlyColor.p3ChannelsNeverEncodedAsHex, true, 'P3 channels must not be hex encoded');

// ---------------------------------------------------------------------------
// 5. Palette: full pairing audit, correction and export/contrast agreement
// ---------------------------------------------------------------------------
const moods = ['editorial', 'cyber-tactile', 'neo-brutalist', 'luxury-dark', 'organic-modern'];
findings.palettes = moods.map(mood => {
  const corrected = generatePalette(mood);
  const uncorrected = generatePalette(mood, undefined, { correctionMode: 'none' });
  const muted = uncorrected.contrastAnalysis.mutedTextOnBg;
  const p3 = generatePalette(mood, undefined, { target: 'p3' });
  const mismatches = p3.contrastAnalysis.fullAudit.filter(pairing =>
    pairing.fgHex !== p3.tokens[pairing.foreground].hex || pairing.bgHex !== p3.tokens[pairing.background].hex
  );
  return {
    mood,
    statusWithCorrection: corrected.status,
    failedWithCorrection: corrected.contrastAnalysis.failedPairings,
    adjustments: corrected.contrastAnalysis.adjustments.length,
    statusWithoutCorrection: uncorrected.status,
    mutedTextOnBgSurface: {
      ratioExact: muted.ratioExact,
      ratio: muted.ratio,
      passed: muted.passed,
      audited: uncorrected.contrastAnalysis.fullAudit.some(p => p.pairing === 'textMutedOnBgSurface'),
      reportedInFailedPairings: uncorrected.contrastAnalysis.failedPairings.includes('textMutedOnBgSurface')
    },
    auditedPairingCount: uncorrected.contrastAnalysis.fullAudit.length,
    p3ExportContrastMismatches: mismatches.length,
    serializedTokensInGamut: Object.values(p3.tokens).every(token =>
      serializedChannelsInGamut(oklchToSrgb(token.l, token.c, token.h, 'p3'))
    )
  };
});
findings.palettePresets = Object.fromEntries(Object.entries(MOOD_PRESETS).map(([mood, preset]) => [mood, preset.baseHue]));

const defaultPalette = await tokensTool.execute({});
findings.defaultPaletteEnvelope = {
  status: defaultPalette.status,
  pairingCount: defaultPalette.data.contrastAnalysis.length,
  failedPairings: defaultPalette.data.failedPairings,
  includeArabicTokens: Boolean(defaultPalette.data.arabicTokens)
};
const withoutArabic = await tokensTool.execute({ includeArabicTokens: false });
findings.includeArabicTokensHasEffect = JSON.stringify(withoutArabic.data) !== JSON.stringify(defaultPalette.data);

// ---------------------------------------------------------------------------
// 6. Gradients: authoring, validation policy, dual exports, contrast sampling
// ---------------------------------------------------------------------------
const authoredGradient = await gradientTool.execute({
  stops: [
    { oklch: { l: 0.2, c: 0.05, h: 350 }, position: 0 },
    { oklch: { l: 0.7, c: 0.12, h: 40 }, position: 0.35, alpha: 0.5 },
    { oklch: { l: 0.95, c: 0.02, h: 200 }, position: 1 }
  ],
  interpolationSpace: 'oklab',
  huePath: 'longer',
  target: 'p3',
  contrastForegroundHex: '#ffffff',
  contrastSamplePositions: [0, 0.35, 1]
});
findings.gradients = {
  authored: {
    status: authoredGradient.status,
    positions: authoredGradient.data.stops.map(s => s.position),
    alphas: authoredGradient.data.stops.map(s => s.alpha),
    css: authoredGradient.data.css,
    cssSrgb: authoredGradient.data.cssSrgb,
    cssP3: authoredGradient.data.cssP3,
    gamut: authoredGradient.data.gamut,
    contrastWorstCase: authoredGradient.data.contrast.worstCase,
    contrastMeetsTarget: authoredGradient.data.contrast.meetsTarget
  },
  invalidStopOrdering: await gradientTool
    .execute({
      fromOklch: { l: 0.5, c: 0.1, h: 0 },
      toOklch: { l: 0.5, c: 0.1, h: 90 },
      steps: 3,
      stops: [
        { oklch: { l: 0.2, c: 0.05, h: 0 }, position: 0.9 },
        { oklch: { l: 0.8, c: 0.05, h: 0 }, position: 0.1 }
      ]
    })
    .then(() => ({ rejected: false }))
    .catch(error => ({ rejected: true, message: String(error.message).slice(0, 120) }))
};
assert.equal(findings.gradients.invalidStopOrdering.rejected, true, 'unordered stops must be rejected');

// ---------------------------------------------------------------------------
// 7. Fluid typography / spacing validation
// ---------------------------------------------------------------------------
const clamp = generateFluidClamp(16, 32, 360, 1440);
findings.fluid = {
  clamp,
  endpointTolerancePx: CLAMP_ENDPOINT_TOLERANCE_PX,
  endpointErrorPx: fluidClampErrorPx(clamp, 360, 1440),
  customRoot: generateFluidClamp(16, 32, 360, 1440, { rootFontPx: 10 }),
  equalViewportsRejected: (() => {
    try { generateFluidClamp(16, 32, 800, 800); return false; } catch { return true; }
  })(),
  reversedViewportsRejected: (() => {
    try { generateFluidClamp(16, 32, 1440, 360); return false; } catch { return true; }
  })(),
  nonFiniteRejected: (() => {
    try { generateFluidClamp(NaN, 32, 360, 1440); return false; } catch { return true; }
  })(),
  containsNaNOrInfinity: /NaN|Infinity/.test(clamp),
  fluidScaleTool: (await fluidTool.execute({ entries: [{ name: 'display', minPx: 38, maxPx: 72 }], rootFontPx: 12 })).data,
  spacing: {
    invalid: {
      zeroRatio: await spacingTool.execute({ ratio: 0 }).then(() => false).catch(() => true),
      negativeRatio: await spacingTool.execute({ ratio: -1.25 }).then(() => false).catch(() => true),
      negativeBase: await spacingTool.execute({ basePx: -16 }).then(() => false).catch(() => true),
      equalViewports: await spacingTool.execute({ fluid: true, minVw: 800, maxVw: 800 }).then(() => false).catch(() => true)
    },
    customRatio: generateSpacingScale(16, 1.5),
    customSteps: generateSpacingScale(8, 1.5, { steps: [{ name: 'tiny', n: -1 }, { name: 'base', n: 0 }, { name: 'big', n: 2 }] }),
    configurableFluidFactor: generateSpacingScale(16, 1.25, { fluid: true, fluidMinFactor: 0.7 }).sm,
    rootFontPx: generateSpacingScale(16, 1.25, { rootFontPx: 10, fluid: true }).sm
  }
};
assert.equal(findings.fluid.containsNaNOrInfinity, false);

// ---------------------------------------------------------------------------
// 8. MCP failure contracts (deterministic local mock, no browser/network)
// ---------------------------------------------------------------------------
const originalExecute = PythonBridge.execute;
try {
  PythonBridge.execute = async () => ({ status: 'error', message: 'postfix-mocked backend failure' });
  const captureEnvelope = await captureTool.execute({ htmlOrUrl: '<html></html>' });
  const pythonEnvelope = await pythonRunnerTool.execute({ action: 'contrast' });
  const server = createServer();
  const localClient = new Client({ name: 'postfix-mock', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await localClient.connect(clientTransport);
  const captureProtocol = await localClient.callTool({ name: 'ink_capture_viewport', arguments: { htmlOrUrl: '<html></html>' } });
  const pythonProtocol = await localClient.callTool({ name: 'ink_run_python_tests', arguments: { action: 'contrast' } });
  findings.failureContracts = {
    captureEnvelope: { status: captureEnvelope.status, data: captureEnvelope.data, outputSchemaValid: captureTool.outputSchema.safeParse(captureEnvelope).success },
    pythonEnvelope: { status: pythonEnvelope.status, data: pythonEnvelope.data, outputSchemaValid: pythonRunnerTool.outputSchema.safeParse(pythonEnvelope).success },
    captureProtocol: { isError: !!captureProtocol.isError, message: captureProtocol.content?.[0]?.text?.slice(0, 200), structuredContent: captureProtocol.structuredContent },
    pythonProtocol: { isError: !!pythonProtocol.isError, message: pythonProtocol.content?.[0]?.text?.slice(0, 200), structuredContent: pythonProtocol.structuredContent },
    annotations: { pythonRunner: pythonRunnerTool.annotations, capture: captureTool.annotations }
  };
  assert.equal(findings.failureContracts.captureProtocol.isError, true, 'backend failures must set isError');
  assert.match(findings.failureContracts.captureProtocol.message, /postfix-mocked backend failure/);
  assert.ok(!/Output validation error/.test(findings.failureContracts.captureProtocol.message ?? ''));
  await localClient.close();
  await server.close();
} finally {
  PythonBridge.execute = originalExecute;
}

// Feature flags
const centeringOn = await validateTool.execute({ code: "<main><section style='width:100vw'></section></main>", checkCentering: true });
const centeringOff = await validateTool.execute({ code: "<main><section style='width:100vw'></section></main>", checkCentering: false });
findings.flags = {
  checkCentering: {
    on: { passed: centeringOn.data.centeringAudit?.passed, checks: centeringOn.data.centeringAudit?.checks.length },
    off: { centeringAudit: centeringOff.data.centeringAudit }
  },
  extractOklchPalette: 'covered by unit + contract + protocol tests',
  targetForwardedToPython: 'covered by contract test'
};

// ---------------------------------------------------------------------------
// 9. dist build matches source
// ---------------------------------------------------------------------------
const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, '.');
const normalize = s => s.replace(/^\/\/# sourceMappingURL=.*$/gm, '').replace(/\r\n/g, '\n').trim();
findings.buildMismatches = [];
findings.buildFilesChecked = 0;
for (const file of config.fileNames.filter(f => f.startsWith('src/'))) {
  const source = await fs.readFile(file, 'utf8');
  const emitted = ts.transpileModule(source, { compilerOptions: { ...config.options, module: ts.ModuleKind.ES2022 }, fileName: file }).outputText;
  const built = await fs.readFile(file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'), 'utf8');
  findings.buildFilesChecked++;
  if (normalize(emitted) !== normalize(built)) findings.buildMismatches.push(file);
}

await fs.writeFile(path.join(outDir, 'verification-results-postfix.json'), JSON.stringify(findings, null, 2) + '\n');
console.log(JSON.stringify({
  tools: findings.protocol.toolCount,
  buildMismatches: findings.buildMismatches,
  buildFilesChecked: findings.buildFilesChecked,
  wcagRoundingRegression: roundingRegression,
  apca: findings.apca.vectors.map(v => ({ fg: v.fg, bg: v.bg, lcExact: v.lcExact, referenceLc: v.referenceLc, ok: v.ok })),
  p3: findings.gamut.p3OnlyColor,
  palettes: findings.palettes.map(p => ({ mood: p.mood, status: p.statusWithCorrection, uncorrectedStatus: p.statusWithoutCorrection, muted: p.mutedTextOnBgSurface.ratio, failed: p.failedWithCorrection.length })),
  fluid: { clamp: findings.fluid.clamp, endpointErrorPx: findings.fluid.endpointErrorPx, equalViewportsRejected: findings.fluid.equalViewportsRejected },
  gradients: { positions: findings.gradients.authored.positions, alphas: findings.gradients.authored.alphas, gamut: findings.gradients.authored.gamut.policy, worstCase: findings.gradients.authored.contrastWorstCase },
  failureContracts: {
    captureIsError: findings.failureContracts.captureProtocol.isError,
    captureMessage: findings.failureContracts.captureProtocol.message,
    pythonIsError: findings.failureContracts.pythonProtocol.isError
  },
  includeArabicTokensHasEffect: findings.includeArabicTokensHasEffect
}, null, 2));