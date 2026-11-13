import fs from 'node:fs/promises';
import {
  mapToGamut, oklchToSrgb, oklchToOklab, oklabToOklch,
  linearP3ToLinearSrgb, linearSrgbToOklab, srgb01ToOklab,
  deltaEOk, channelsInGamut
} from '../../dist/domain/design-tokens/gamut-mapper.js';
import { interpolateAt } from '../../dist/domain/design-tokens/gradient-interpolator.js';
import { gradientTool } from '../../dist/tools/gradient.tool.js';

// Independent target-aware version of CSS Color 4 local-MINDE pseudocode.
// Shared conversion matrices are reused; target-aware RGB -> OKLab is explicit.
const decode = v => v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;
const clip = v => Object.fromEntries(Object.entries(v).map(([k,x])=>[k,Math.min(1,Math.max(0,x))]));
const targetToLab = (v,target) => target==='srgb'?srgb01ToOklab(v):linearSrgbToOklab(linearP3ToLinearSrgb({r:decode(v.r),g:decode(v.g),b:decode(v.b)}));
function referenceMap(l,c,h,target) {
  const origin=oklchToSrgb(l,c,h,target);
  if(channelsInGamut(origin)) return origin;
  const originLab=oklchToOklab(l,c,h);
  let clipped=clip(origin);
  if(deltaEOk(targetToLab(clipped,target),originLab)<0.02) return clipped;
  let min=0,max=c,minInGamut=true;
  while(max-min>0.0001) {
    const chroma=(min+max)/2;
    const raw=oklchToSrgb(l,chroma,h,target);
    if(minInGamut&&channelsInGamut(raw)){min=chroma;continue;}
    clipped=clip(raw);
    const error=deltaEOk(targetToLab(clipped,target),oklchToOklab(l,chroma,h));
    if(error<0.02) {
      if(0.02-error<0.0001) return clipped;
      minInGamut=false; min=chroma;
    } else max=chroma;
  }
  return clipped;
}
const requested={l:0.7,c:0.3,h:30};
const actual=mapToGamut(requested.l,requested.c,requested.h,'p3');
const referenceChannels=referenceMap(requested.l,requested.c,requested.h,'p3');
const actualLab=targetToLab(actual.channels,'p3'), referenceLab=targetToLab(referenceChannels,'p3');

const transparentInput={
  stops:[{oklch:{l:0.6,c:0.1,h:30},position:0,alpha:0.5},{oklch:{l:0.6,c:0.1,h:150},position:1,alpha:0.5}],
  interpolationSpace:'oklch',huePath:'shorter'
};
const alphaGradient=await gradientTool.execute(transparentInput);
const resolved=transparentInput.stops.map(s=>({...s,lab:oklchToOklab(s.oklch.l,s.oklch.c,s.oklch.h)}));
const midpoint=interpolateAt(resolved,0.5,'oklch','shorter');
const positioned=await gradientTool.execute({stops:[{oklch:{l:0.5,c:0.05,h:30},position:0.2},{oklch:{l:0.6,c:0.05,h:60},position:0.8}]});
const huePath=await gradientTool.execute({stops:[{oklch:{l:0.6,c:0.05,h:350},position:0},{oklch:{l:0.6,c:0.05,h:10},position:0.5},{oklch:{l:0.6,c:0.05,h:30},position:1}],huePath:'longer'});
const transparentContrast=await gradientTool.execute({stops:[{oklch:{l:0,c:0,h:0},position:0,alpha:0},{oklch:{l:0,c:0,h:0},position:1,alpha:0}],contrastForegroundHex:'#ffffff',contrastSamplePositions:[0,0.5,1]});
const report={
  packageVersion:JSON.parse(await fs.readFile('package.json','utf8')).version,
  p3Mapping:{requested,actualChannels:actual.channels,referenceChannels,deltaEOKBetweenResults:deltaEOk(actualLab,referenceLab),actualOklch:actual.oklch,referenceOklch:oklabToOklch(referenceLab),source:'gamut-mapper.ts:439,450,471 use srgb01ToOklab on P3 channels'},
  transparentGradient:{css:alphaGradient.data.css,cssSrgb:alphaGradient.data.cssSrgb,invalidOklchAlphaSyntax:/oklch\([^)]*\)\s*\//.test(alphaGradient.data.css),midpoint,expectedOklchMidpoint:{l:0.6,c:0.1,h:90},source:'gradient-interpolator.ts:285,338'},
  authoredPositions:{css:positioned.data.css,expectedPositions:[0.2,0.8],positionsPreserved:positioned.data.css.includes('20%')&&positioned.data.css.includes('80%'),source:'gradient-interpolator.ts:477,483'},
  huePath:{requested:'longer',css:huePath.data.css,methodSerialized:huePath.data.css.includes('longer hue'),source:'gradient-interpolator.ts:502'},
  alphaContrast:{reportedRatio:transparentContrast.data.contrast.worstCase.ratioExact,reportedPass:transparentContrast.data.contrast.meetsTarget,expectedRatioOverWhiteCanvas:1,explanation:'Fully transparent black gradient over white leaves a white background; white text has 1:1 contrast. Underlying canvas is not accepted or composited.',source:'gradient-interpolator.ts:676-680'}
};
await fs.writeFile('docs/audit-2026-10-03/independent-recheck-results.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
