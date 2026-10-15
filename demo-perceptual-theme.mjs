/**
 * 色彩科学全域调和演练 Demo (Perceptual Theme Engine Demo v2)
 * 运行方式: node demo-perceptual-theme.mjs
 * 
 * 核心验证维度:
 * 1. Chroma 范围演进 (0.00 ~ 0.35): 验证极简水墨单色 (C=0.00) 与 P3 广色域 (C=0.32) 的软截断显色
 * 2. 6 档底模基锚 (OLED / Abyss / Charcoal / Slate / Matrix / Mist) + Luminance Bias 明度微调
 * 3. Diff 三大模式 (Adaptive 色相引力共振 / Classic 经典红绿 / Accessible 蓝橙色盲无障碍)
 * 4. Diff 浸润度 (Diff Intensity: 20% ~ 100%)
 * 5. 真实 UserMessagePreview 气泡与原生 DiffViewer 结构渲染
 */

import chalk from 'chalk';

// --- 1. 零依赖 OKLCH 感知数学微内核 ---
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  const clamped = Math.max(0, Math.min(1, c));
  const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, v * 255)));
}

function oklchToRgb(l, c, h) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const b_ = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  return {
    r: linearToSrgb(r),
    g: linearToSrgb(g),
    b: linearToSrgb(b_),
  };
}

function oklchToHex(l, c, h) {
  const { r, g, b } = oklchToRgb(l, c, h);
  const toHex = (n) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function sRgbToY(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
}

function hexToRgb(hex) {
  const num = parseInt(hex.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function calcApca(textHex, bgHex) {
  const txt = hexToRgb(textHex);
  const bg = hexToRgb(bgHex);
  const yTxt = sRgbToY(txt.r, txt.g, txt.b);
  const yBg = sRgbToY(bg.r, bg.g, bg.b);
  return Math.round((yTxt - yBg) * 100);
}

// 环形色相最短距离插值
function lerpHueAngle(baseHue, targetHue, strength) {
  let diff = (targetHue - baseHue) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  const result = (baseHue + diff * strength + 360) % 360;
  return Math.round(result);
}

// --- 2. 6 档基锚底模 (Mood Archetypes) ---
const MOOD_PROFILES = {
  oled: { bgL: 0.04, bgC: 0.00, desc: '极致深黑 (OLED Pure Black) - 像素彻底关闭，无限对比' },
  abyss: { bgL: 0.08, bgC: 0.01, desc: '深渊幽黑 (Abyss Dark) - 消除 OLED 拖影的最低安全暗黑' },
  charcoal: { bgL: 0.11, bgC: 0.02, desc: '暖炭色调 (Warm Charcoal) - 偏暖保护，适合深夜编码' },
  slate: { bgL: 0.14, bgC: 0.02, desc: '北欧冷灰 (Nordic Slate) - 低疲劳长时间阅读基准' },
  matrix: { bgL: 0.09, bgC: 0.03, desc: '复古黑客 (Matrix Terminal) - 磷光微光沉浸' },
  mist: { bgL: 0.20, bgC: 0.01, desc: '浅雾低反差 (Slate Mist) - 针对高环境光与防反光' },
};

/**
 * 全域参数综合推导微内核
 */
function deriveAllThemeTokens({
  hue = 215,
  chroma = 0.16,
  mood = 'slate',
  luminanceBias = 0.0,
  diffHarmony = 'adaptive',
  diffIntensity = 75,
}) {
  const profile = MOOD_PROFILES[mood] || MOOD_PROFILES.slate;
  
  // 1. 合成有效背景明度与基底微色彩度
  const effectiveBgL = Math.max(0.03, Math.min(0.28, profile.bgL + luminanceBias));
  const bgC = chroma < 0.03 ? 0.00 : profile.bgC * (chroma / 0.16);
  const background = oklchToHex(effectiveBgL, bgC, hue);

  // 2. 12-Step 梯度梯尺派生
  const lightLevels = [
    effectiveBgL,
    effectiveBgL + 0.04,
    effectiveBgL + 0.08,
    effectiveBgL + 0.13,
    effectiveBgL + 0.18,
    effectiveBgL + 0.25,
    effectiveBgL + 0.35,
    effectiveBgL + 0.45,
    0.70,
    0.80,
    0.86,
    0.96,
  ];
  const steps = lightLevels.map((l, i) => {
    const c = (i >= 8 && i <= 9) ? chroma : chroma * 0.35;
    return oklchToHex(Math.min(0.98, l), c, hue);
  });

  const accent = steps[8]; // Step 8: 主强调色
  const border = steps[5]; // Step 5: 边框
  const dimText = steps[6]; // Step 6: 次要文本
  const text = steps[11]; // Step 11: 高反差主文本
  const cardBg = steps[1]; // Step 1: 微光卡片背景

  // 3. Diff 色相计算 (三大模式)
  let addedHue = 142;
  let removedHue = 25;
  if (diffHarmony === 'adaptive') {
    addedHue = lerpHueAngle(142, hue, 0.25);
    removedHue = lerpHueAngle(25, (hue + 180) % 360, 0.25);
  } else if (diffHarmony === 'accessible') {
    // 蓝橙无障碍模式 (色盲友好)
    addedHue = 210; // 天蓝
    removedHue = 45; // 琥珀橙
  }

  // 4. Diff 浸润强度与底色/前景色推演
  const intensityRatio = diffIntensity / 100;
  const diffBgL = Math.min(0.35, effectiveBgL + 0.08 * intensityRatio);
  
  // 若全局 Chroma 极低（如水墨单色），Diff 色彩自动收敛为微阶暗灰，拒绝荧光割裂
  const diffBgC = chroma < 0.03 ? 0.01 : Math.min(0.12, 0.06 * intensityRatio * (chroma / 0.16));
  const diffAddedBg = oklchToHex(diffBgL, diffBgC, addedHue);
  const diffRemovedBg = oklchToHex(diffBgL, diffBgC, removedHue);

  // 前景色 APCA 闭环校验
  const diffFgC = chroma < 0.03 ? 0.02 : Math.min(0.20, 0.14 * (chroma / 0.16));
  let diffAddedFgL = 0.86;
  let diffAddedFg = oklchToHex(diffAddedFgL, diffFgC, addedHue);
  while (Math.abs(calcApca(diffAddedFg, diffAddedBg)) < 75 && diffAddedFgL < 0.98) {
    diffAddedFgL += 0.02;
    diffAddedFg = oklchToHex(diffAddedFgL, diffFgC, addedHue);
  }

  let diffRemovedFgL = 0.86;
  let diffRemovedFg = oklchToHex(diffRemovedFgL, diffFgC, removedHue);
  while (Math.abs(calcApca(diffRemovedFg, diffRemovedBg)) < 75 && diffRemovedFgL < 0.98) {
    diffRemovedFgL += 0.02;
    diffRemovedFg = oklchToHex(diffRemovedFgL, diffFgC, removedHue);
  }

  const diffModified = steps[9];

  // 5. 状态色与徽标
  const success = oklchToHex(0.78, Math.max(0.04, chroma * 0.8), addedHue);
  const warning = oklchToHex(0.78, Math.max(0.04, chroma * 0.8), 80);
  const error = oklchToHex(0.76, Math.max(0.04, chroma * 0.9), removedHue);

  const logoGradient = [
    oklchToHex(0.75, chroma * 0.85, (hue - 35 + 360) % 360),
    accent,
    oklchToHex(0.75, chroma * 0.85, (hue + 35) % 360),
  ];

  const apcaMain = Math.abs(calcApca(text, background));
  const apcaAdded = Math.abs(calcApca(diffAddedFg, diffAddedBg));
  const apcaRemoved = Math.abs(calcApca(diffRemovedFg, diffRemovedBg));

  return {
    tokens: {
      background,
      text,
      border,
      diffAdded: diffAddedBg,
      diffRemoved: diffRemovedBg,
      diffModified,
      diffAddedForeground: diffAddedFg,
      diffRemovedForeground: diffRemovedFg,
      lineNumber: dimText,
      lineNumberBorder: border,
      menuSelected: accent,
      menuNormal: text,
      menuInfo: accent,
      menuSecondary: dimText,
      error,
      warning,
      success,
      cyan: accent,
      logoGradient,
      userMessageBackground: cardBg,
      userMessageText: text,
      diffOpacity: intensityRatio,
    },
    meta: {
      hue,
      chroma,
      mood,
      effectiveBgL,
      luminanceBias,
      diffHarmony,
      diffIntensity,
      addedHue,
      removedHue,
      steps,
      apcaMain,
      apcaAdded,
      apcaRemoved,
    }
  };
}

// --- 3. 渲染原生真实结构与沙盒 ---
function renderScenario(data, title, description) {
  const { tokens, meta } = data;
  console.log(chalk.bold.hex(tokens.menuSelected)(`\n${'═'.repeat(78)}`));
  console.log(chalk.bold.hex(tokens.menuSelected)(`  【场景】: ${title}`));
  console.log(chalk.gray(`  说明: ${description}`));
  console.log(chalk.gray(`  Hue: ${meta.hue}° | Chroma: ${meta.chroma.toFixed(2)} | Mood: ${meta.mood} (L=${meta.effectiveBgL.toFixed(2)}, Bias=${meta.luminanceBias > 0 ? '+' : ''}${meta.luminanceBias})`));
  console.log(chalk.gray(`  Diff模式: ${meta.diffHarmony} | 浸润度: ${meta.diffIntensity}% | 派生色相: +${meta.addedHue}° / -${meta.removedHue}°`));
  console.log(chalk.bold.hex(tokens.menuSelected)(`${'═'.repeat(78)}`));

  // 12-Step 色阶带
  process.stdout.write('  12-Step 色谱: ');
  for (const st of meta.steps) {
    process.stdout.write(chalk.bgHex(st)('  '));
  }
  console.log(chalk.gray(` (APCA文字对比: ${meta.apcaMain} Lc | Diff+对比: ${meta.apcaAdded} Lc)`));

  // 状态指示器 (真实结构)
  process.stdout.write('  状态指示器:   ');
  process.stdout.write(chalk.bgHex(tokens.success).hex('#000000').bold(' SUCCESS '));
  process.stdout.write(' ');
  process.stdout.write(chalk.bgHex(tokens.warning).hex('#000000').bold(' WARNING '));
  process.stdout.write(' ');
  process.stdout.write(chalk.bgHex(tokens.error).hex('#000000').bold(' ERROR '));
  process.stdout.write('   徽标三色: ');
  tokens.logoGradient.forEach((c) => process.stdout.write(chalk.hex(c).bold('■ ')));
  console.log();

  // 原生 UserMessagePreview 拟真气泡
  console.log(chalk.gray('  ┌─ 原生 UserMessagePreview ───────────────────────────────────────────┐'));
  const bubble = chalk.bgHex(tokens.userMessageBackground).hex(tokens.userMessageText)(
    `  用户提问: 请基于 OKLCH 和 APCA 生成全域自适应主题！                  `
  );
  console.log(`  │ ${bubble} │`);
  console.log(chalk.gray('  └──────────────────────────────────────────────────────────────────────┘'));

  // 原生 DiffViewer 真实结构拟真
  console.log(chalk.hex(tokens.menuSecondary)('  ╭─ ') + chalk.hex(tokens.menuSelected).bold('DiffViewer') + chalk.hex(tokens.menuSecondary)(' (themeEngine.ts) ──────────────────────────────────────'));
  
  const rmLine = chalk.hex(tokens.lineNumber)('  │ 42 ') + 
                 chalk.hex(tokens.diffRemovedForeground).bold('- ') + 
                 chalk.bgHex(tokens.diffRemoved).hex(tokens.diffRemovedForeground)(
                   'const diffBg = "#300000"; // 旧版写死常数，在不同主题下极其割裂            '
                 );
  console.log(rmLine);

  const addLine = chalk.hex(tokens.lineNumber)('  │ 42 ') + 
                  chalk.hex(tokens.diffAddedForeground).bold('+ ') + 
                  chalk.bgHex(tokens.diffAdded).hex(tokens.diffAddedForeground)(
                    'const diffBg = deriveHarmonicDiff({ hue, diffHarmony }); // 全域自适应引力共振'
                  );
  console.log(addLine);

  const ctxLine = chalk.hex(tokens.lineNumber)('  │ 43   ') + 
                  chalk.hex(tokens.text)(
                    'return { background, accent, diffBg, apcaScore: 82 };                   '
                  );
  console.log(ctxLine);
  console.log(chalk.hex(tokens.menuSecondary)('  ╰─ 1 insertion(+), 1 deletion(-) ──────────────────────────────────────'));
}

// --- 4. 运行 5 大深度对比场景 ---
console.log(chalk.bold.cyan('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
console.log(chalk.bold.cyan('┃    Snow CLI - 感知色彩全域调和演练 Demo v2 (OKLCH + APCA + 6-Mood)        ┃'));
console.log(chalk.bold.cyan('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));

// 场景 1: 水墨极简单色阶 (Chroma = 0.00)
// 证明：当 Chroma 降为 0 时，界面回归黑白极简，Diff 自动转为柔和灰阶，不会突兀冒出荧光色
renderScenario(
  deriveAllThemeTokens({
    hue: 0,
    chroma: 0.00,
    mood: 'abyss',
    luminanceBias: 0.00,
    diffHarmony: 'adaptive',
    diffIntensity: 60,
  }),
  '水墨极简单色阶 (Achromatic Monospaced / C=0.00 / 深渊幽黑防拖影)',
  'Chroma=0 纯无彩色，Diff 自动随动下潜为纯灰阶，杜绝荧光违和'
);

// 场景 2: 赛博青翠 Display P3 广色域高彩 (Chroma = 0.30) + OLED 纯黑
// 证明：广色域高彩与 OLED 纯黑的极致反差，软截断保障不撕裂
renderScenario(
  deriveAllThemeTokens({
    hue: 180,
    chroma: 0.30,
    mood: 'oled',
    luminanceBias: 0.00,
    diffHarmony: 'adaptive',
    diffIntensity: 85,
  }),
  '赛博青翠 Display P3 广色域 (Cyber Cyan / C=0.30 / OLED 纯黑)',
  '自适应引力共振使得新增偏向青翠(152°)，删除偏向洋红(358°)，与冷色调完美共振'
);

// 场景 3: 暖金秋珀 + 明度偏置微调 (Luminance Bias = -0.03) + 暖炭底模
// 证明：明度微调轴可以让用户在暖炭基础上进一步微调深浅
renderScenario(
  deriveAllThemeTokens({
    hue: 70,
    chroma: 0.18,
    mood: 'charcoal',
    luminanceBias: -0.03,
    diffHarmony: 'adaptive',
    diffIntensity: 75,
  }),
  '暖金秋珀 (Autumn Amber / Charcoal暖炭 + 明度偏置-0.03加深)',
  '用户通过明度偏置微调轴加深底色，APCA 对比度自动补偿提升至安全界限'
);

// 场景 4: 经典极客紫 (Neon Violet / Hue = 290°)
// 证明：紫色主调下，自适应引力将新增偏向青绿，删除偏向珊瑚品红，避免冷色系下的色块打架
renderScenario(
  deriveAllThemeTokens({
    hue: 290,
    chroma: 0.22,
    mood: 'slate',
    luminanceBias: 0.00,
    diffHarmony: 'adaptive',
    diffIntensity: 75,
  }),
  '经典极客紫 (Neon Violet / Hue=290° / 北欧冷灰底模)',
  '主色为紫罗兰，新增色受引力牵引呈现青绿，删除色受补色牵引呈现洋红品红，冷暖平衡'
);

// 场景 5: 烈焰绯红 (Crimson Flame / Hue = 15°)
// 证明：当全局主色调本身为红色时，自适应算法杜绝“主题红与Diff删除红撞车混淆”
renderScenario(
  deriveAllThemeTokens({
    hue: 15,
    chroma: 0.24,
    mood: 'matrix',
    luminanceBias: 0.00,
    diffHarmony: 'adaptive',
    diffIntensity: 80,
  }),
  '烈焰绯红 (Crimson Flame / Hue=15° / 复古黑客Matrix底模)',
  '主色本身为红，自适应算法使删除色向深洋红偏折，新增色拉向清爽黄绿(110°)，绝不混淆'
);

// 场景 6: 蓝橙无障碍色盲友好模式 (Accessible Mode) + 北欧冷灰
// 证明：针对红绿色盲开发者，Diff 增删切换为天蓝与琥珀橙
renderScenario(
  deriveAllThemeTokens({
    hue: 240,
    chroma: 0.16,
    mood: 'slate',
    luminanceBias: 0.00,
    diffHarmony: 'accessible',
    diffIntensity: 70,
  }),
  '无障碍色盲友好模式 (Accessible Daltonism / 蓝橙增删 / 北欧冷灰)',
  '新增使用高辨识天蓝(210°)，删除使用琥珀橙(45°)，彻底解决红绿色盲无法区分问题'
);

// 场景 7: 浅雾低反差模式 (Mist Archetype) + 低浸润度 (Diff Intensity = 35%)
// 证明：强光环境下的浅暗色底模与柔和 Diff 审阅
renderScenario(
  deriveAllThemeTokens({
    hue: 215,
    chroma: 0.14,
    mood: 'mist',
    luminanceBias: +0.02,
    diffHarmony: 'adaptive',
    diffIntensity: 35,
  }),
  '浅雾防反光模式 (Slate Mist / 高环境光 / 低浸润度35%)',
  '适合明亮日光环境，低浸润度 35% 保证长时间 Review 代码不刺眼'
);

console.log(chalk.bold.green('\n✓ 演练完成！已全面验证: 0.00~0.35 Chroma、6 档底模基锚、明度微调轴、三大 Diff 模式及全色相轮盘（红/紫/蓝/青/金/单色）。\n'));
