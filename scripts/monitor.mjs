import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'https://support.dji.com/recycle/apply';
const DATA_DIR = path.resolve('data');
const SNAPSHOT_FILE = path.join(DATA_DIR, 'dji-models.json');
const SUMMARY_FILE = path.resolve('change-summary.md');
const DEBUG_DIR = path.resolve('debug');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DEBUG_DIR, { recursive: true });

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[✓✔]/g, '')
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `${name}=${String(value)}\n`);
  }
}

async function clickModelDropdown(page) {
  // 优先点击带 combobox 语义的下拉框。
  const comboboxes = page.locator(
    '[role="combobox"], .ant-select-selector, [class*="select"][class*="selector"]'
  );

  const count = await comboboxes.count();
  for (let i = 0; i < count; i += 1) {
    const item = comboboxes.nth(i);
    if (!(await item.isVisible().catch(() => false))) continue;

    const nearbyText = await item.evaluate((el) => {
      const parent = el.closest('div');
      return (parent?.parentElement?.innerText || parent?.innerText || '').slice(0, 500);
    }).catch(() => '');

    if (
      nearbyText.includes('换购机型版本') ||
      nearbyText.includes('DJI Mavic') ||
      nearbyText.includes('DJI Mini') ||
      nearbyText.includes('DJI Air') ||
      nearbyText.includes('DJI Neo')
    ) {
      await item.click({ force: true });
      return;
    }
  }

  // 兜底：从“换购机型版本”文字附近寻找可点击元素。
  const label = page.getByText('换购机型版本', { exact: true }).first();
  await label.waitFor({ state: 'visible', timeout: 20_000 });

  const candidates = [
    label.locator('xpath=following::*[@role="combobox"][1]'),
    label.locator('xpath=following::*[contains(@class,"select")][1]'),
    label.locator('xpath=..').locator('[role="combobox"], .ant-select-selector').first(),
    label.locator('xpath=../..').locator('[role="combobox"], .ant-select-selector').first(),
  ];

  for (const candidate of candidates) {
    if (await candidate.isVisible().catch(() => false)) {
      await candidate.click({ force: true });
      return;
    }
  }

  throw new Error('没有找到“换购机型版本”下拉框。');
}

async function collectDropdownOptions(page) {
  const optionSelector = [
    '[role="option"]',
    '.ant-select-item-option',
    '[class*="select-item-option"]',
    '[class*="option"][title]'
  ].join(',');

  const listSelector = [
    '[role="listbox"]',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '[class*="select-dropdown"]:not([class*="hidden"])'
  ].join(',');

  const result = new Set();

  // 等待至少一个选项出现。
  await page.locator(optionSelector).first().waitFor({
    state: 'visible',
    timeout: 20_000
  });

  const list = page.locator(listSelector).filter({ visible: true }).last();
  const scrollTarget = (await list.count()) ? list : page.locator(optionSelector).first().locator('xpath=..');

  let unchangedRounds = 0;
  let previousSize = -1;

  // 处理虚拟滚动：不断收集当前可见项并向下滚动。
  for (let round = 0; round < 120; round += 1) {
    const texts = await page.locator(optionSelector).evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0;
        })
        .map((node) =>
          (node.getAttribute('title') || node.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
        )
    );

    for (const text of texts) {
      const cleaned = cleanText(text);
      if (/^DJI\s+/i.test(cleaned)) result.add(cleaned);
    }

    if (result.size === previousSize) unchangedRounds += 1;
    else unchangedRounds = 0;
    previousSize = result.size;

    const state = await scrollTarget.evaluate((el) => {
      const candidates = [
        el,
        el.querySelector('.rc-virtual-list-holder'),
        el.querySelector('[class*="virtual-list-holder"]'),
        el.querySelector('[style*="overflow"]')
      ].filter(Boolean);

      const target =
        candidates.find((node) => node.scrollHeight > node.clientHeight + 2) || el;

      const before = target.scrollTop;
      const max = Math.max(0, target.scrollHeight - target.clientHeight);
      target.scrollTop = Math.min(max, before + Math.max(target.clientHeight * 0.8, 240));
      target.dispatchEvent(new Event('scroll', { bubbles: true }));

      return {
        before,
        after: target.scrollTop,
        max,
        atBottom: target.scrollTop >= max - 2
      };
    }).catch(() => ({ before: 0, after: 0, max: 0, atBottom: true }));

    await page.waitForTimeout(250);

    if (state.atBottom && unchangedRounds >= 3) break;
  }

  return uniqueSorted([...result]);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: { width: 1440, height: 1200 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
});

const page = await context.newPage();
page.setDefaultTimeout(20_000);

try {
  await page.goto(URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000
  });

  await page.waitForTimeout(4_000);
  await clickModelDropdown(page);
  await page.waitForTimeout(1_000);

  const models = await collectDropdownOptions(page);

  await page.screenshot({
    path: path.join(DEBUG_DIR, 'latest.png'),
    fullPage: true
  });

  if (models.length < 2) {
    throw new Error(`只读取到 ${models.length} 个机型，结果可能不完整：${models.join('、')}`);
  }

  const now = new Date().toISOString();
  const current = {
    url: URL,
    checkedAt: now,
    count: models.length,
    models
  };

  if (!fs.existsSync(SNAPSHOT_FILE)) {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2) + '\n');
    fs.writeFileSync(
      SUMMARY_FILE,
      `# DJI 换购机型监控已初始化\n\n首次记录到 **${models.length}** 个机型。\n`
    );
    writeOutput('changed', 'false');
    writeOutput('baseline_created', 'true');
    writeOutput('model_count', models.length);
    console.log(`首次运行：已保存 ${models.length} 个机型作为基准。`);
    process.exitCode = 0;
  } else {
    const previous = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    const oldModels = uniqueSorted(previous.models || []);

    const added = models.filter((item) => !oldModels.includes(item));
    const removed = oldModels.filter((item) => !models.includes(item));
    const changed = added.length > 0 || removed.length > 0;

    const lines = [
      '# DJI 换购机型下拉列表发生变化',
      '',
      `- 检查时间：${now}`,
      `- 页面：${URL}`,
      `- 原数量：${oldModels.length}`,
      `- 新数量：${models.length}`,
      ''
    ];

    if (added.length) {
      lines.push('## 新增机型', '', ...added.map((item) => `- ${item}`), '');
    }
    if (removed.length) {
      lines.push('## 删除或改名的机型', '', ...removed.map((item) => `- ${item}`), '');
    }
    if (!changed) {
      lines.push('本次未检测到变化。', '');
    }

    fs.writeFileSync(SUMMARY_FILE, lines.join('\n'));
    writeOutput('changed', changed ? 'true' : 'false');
    writeOutput('baseline_created', 'false');
    writeOutput('model_count', models.length);

    if (changed) {
      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(current, null, 2) + '\n');
      console.log(`检测到变化：新增 ${added.length} 个，删除或改名 ${removed.length} 个。`);
    } else {
      console.log(`没有变化，当前共 ${models.length} 个机型。`);
    }
  }
} catch (error) {
  await page.screenshot({
    path: path.join(DEBUG_DIR, 'error.png'),
    fullPage: true
  }).catch(() => {});

  console.error(error);
  throw error;
} finally {
  await browser.close();
}
