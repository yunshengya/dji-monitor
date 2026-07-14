import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'https://support.dji.com/recycle/apply';

const DATA_DIR = path.resolve('data');
const DEBUG_DIR = path.resolve('debug');

const SNAPSHOT_FILE = path.join(DATA_DIR, 'dji-models.json');
const SUMMARY_FILE = path.resolve('change-summary.md');

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

  if (!outputFile) {
    console.log(`[output] ${name}=${value}`);
    return;
  }

  fs.appendFileSync(outputFile, `${name}=${String(value)}\n`);
}

async function saveDebugInfo(page, filename) {
  try {
    await page.screenshot({
      path: path.join(DEBUG_DIR, filename),
      fullPage: true
    });
  } catch (error) {
    console.warn('保存截图失败：', error.message);
  }

  try {
    const html = await page.content();
    fs.writeFileSync(
      path.join(DEBUG_DIR, filename.replace(/\.png$/i, '.html')),
      html,
      'utf8'
    );
  } catch (error) {
    console.warn('保存 HTML 失败：', error.message);
  }
}

async function printPageInfo(page, response) {
  const bodyText = await page.locator('body').innerText().catch(() => '');

  console.log('====================================');
  console.log('HTTP 状态：', response?.status() ?? '未知');
  console.log('最终地址：', page.url());
  console.log('页面标题：', await page.title().catch(() => ''));
  console.log('页面前 3000 字：');
  console.log(bodyText.slice(0, 3000));
  console.log('====================================');
}

async function closePossiblePopups(page) {
  const texts = [
    '同意',
    '接受',
    '全部接受',
    '接受全部',
    '我知道了',
    '确定',
    '关闭',
    'Accept',
    'Accept All',
    'I Agree',
    'Got it'
  ];

  for (const text of texts) {
    const locator = page.getByRole('button', {
      name: text,
      exact: true
    });

    if (await locator.first().isVisible().catch(() => false)) {
      console.log(`尝试关闭弹窗：${text}`);

      await locator.first().click({
        force: true,
        timeout: 3000
      }).catch(() => {});
    }
  }

  const selectors = [
    '[aria-label="Close"]',
    '[aria-label="关闭"]',
    '.cookie-close',
    '.modal-close',
    '.ant-modal-close',
    '[class*="cookie"] [class*="close"]',
    '[class*="dialog"] [class*="close"]'
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if (await locator.isVisible().catch(() => false)) {
      console.log(`尝试关闭元素：${selector}`);

      await locator.click({
        force: true,
        timeout: 3000
      }).catch(() => {});
    }
  }
}

async function clickModelDropdown(page) {
  console.log('开始查找换购机型下拉框……');

  const directSelectors = [
    '[role="combobox"]',
    '.ant-select-selector',
    '.el-select',
    '.el-select__wrapper',
    '[class*="select-selector"]',
    '[class*="select"][class*="control"]'
  ];

  for (const selector of directSelectors) {
    const items = page.locator(selector);
    const count = await items.count();

    console.log(`选择器 ${selector} 找到 ${count} 个元素`);

    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);

      if (!(await item.isVisible().catch(() => false))) {
        continue;
      }

      const nearbyText = await item.evaluate((element) => {
        let current = element;

        for (let level = 0; level < 5 && current; level += 1) {
          const text = current.innerText || current.textContent || '';

          if (text.trim()) {
            return text.slice(0, 1000);
          }

          current = current.parentElement;
        }

        return '';
      }).catch(() => '');

      console.log(`候选元素 ${index} 附近文字：`, nearbyText.slice(0, 300));

      if (
        nearbyText.includes('换购机型版本') ||
        nearbyText.includes('DJI Mavic') ||
        nearbyText.includes('DJI Mini') ||
        nearbyText.includes('DJI Air') ||
        nearbyText.includes('DJI Neo')
      ) {
        console.log(`点击候选下拉框：${selector}，序号 ${index}`);

        await item.scrollIntoViewIfNeeded().catch(() => {});
        await item.click({
          force: true,
          timeout: 10000
        });

        return;
      }
    }
  }

  const labelCandidates = [
    page.getByText('换购机型版本', { exact: true }),
    page.getByText('换购机型版本', { exact: false }),
    page.getByText('机型版本', { exact: false }),
    page.getByText('换购机型', { exact: false })
  ];

  for (const labels of labelCandidates) {
    const count = await labels.count();

    for (let index = 0; index < count; index += 1) {
      const label = labels.nth(index);

      if (!(await label.isVisible().catch(() => false))) {
        continue;
      }

      console.log('找到下拉框标签：', await label.innerText().catch(() => ''));

      const candidates = [
        label.locator('xpath=following::*[@role="combobox"][1]'),
        label.locator(
          'xpath=following::*[contains(@class,"select")][1]'
        ),
        label.locator('xpath=..').locator(
          '[role="combobox"], .ant-select-selector, .el-select, [class*="select"]'
        ).first(),
        label.locator('xpath=../..').locator(
          '[role="combobox"], .ant-select-selector, .el-select, [class*="select"]'
        ).first(),
        label.locator('xpath=../../..').locator(
          '[role="combobox"], .ant-select-selector, .el-select, [class*="select"]'
        ).first()
      ];

      for (const candidate of candidates) {
        if (await candidate.isVisible().catch(() => false)) {
          console.log('点击标签附近的下拉框');

          await candidate.scrollIntoViewIfNeeded().catch(() => {});
          await candidate.click({
            force: true,
            timeout: 10000
          });

          return;
        }
      }
    }
  }

  throw new Error(
    `没有找到“换购机型版本”下拉框。当前页面地址：${page.url()}`
  );
}

async function collectDropdownOptions(page) {
  const optionSelector = [
    '[role="option"]',
    '.ant-select-item-option',
    '.el-select-dropdown__item',
    '[class*="select-item-option"]',
    '[class*="option"][title]',
    '[class*="dropdown"] li'
  ].join(',');

  const listSelector = [
    '[role="listbox"]',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '.el-select-dropdown',
    '[class*="select-dropdown"]:not([class*="hidden"])',
    '[class*="dropdown-menu"]'
  ].join(',');

  console.log('等待下拉选项出现……');

  await page.locator(optionSelector).first().waitFor({
    state: 'visible',
    timeout: 30000
  });

  const result = new Set();

  const visibleLists = page.locator(listSelector);
  const listCount = await visibleLists.count();

  let scrollTarget;

  for (let index = listCount - 1; index >= 0; index -= 1) {
    const candidate = visibleLists.nth(index);

    if (await candidate.isVisible().catch(() => false)) {
      scrollTarget = candidate;
      break;
    }
  }

  if (!scrollTarget) {
    scrollTarget = page.locator(optionSelector).first().locator('xpath=..');
  }

  let previousSize = -1;
  let unchangedRounds = 0;

  for (let round = 0; round < 120; round += 1) {
    const texts = await page.locator(optionSelector).evaluateAll((nodes) => {
      return nodes
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();

          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((node) => {
          return (
            node.getAttribute('title') ||
            node.getAttribute('aria-label') ||
            node.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        });
    });

    for (const text of texts) {
      const cleaned = cleanText(text);

      if (
        /^DJI\s+/i.test(cleaned) ||
        cleaned.includes('Mavic') ||
        cleaned.includes('Mini') ||
        cleaned.includes('Air ') ||
        cleaned.includes('Neo')
      ) {
        result.add(cleaned);
      }
    }

    console.log(`第 ${round + 1} 轮，累计读取 ${result.size} 个机型`);

    if (result.size === previousSize) {
      unchangedRounds += 1;
    } else {
      unchangedRounds = 0;
    }

    previousSize = result.size;

    const scrollState = await scrollTarget.evaluate((element) => {
      const candidates = [
        element,
        element.querySelector('.rc-virtual-list-holder'),
        element.querySelector('[class*="virtual-list-holder"]'),
        element.querySelector('[class*="scroll"]'),
        element.querySelector('[style*="overflow"]')
      ].filter(Boolean);

      const target =
        candidates.find(
          (node) => node.scrollHeight > node.clientHeight + 2
        ) || element;

      const before = target.scrollTop;
      const maximum = Math.max(
        0,
        target.scrollHeight - target.clientHeight
      );

      target.scrollTop = Math.min(
        maximum,
        before + Math.max(target.clientHeight * 0.8, 240)
      );

      target.dispatchEvent(
        new Event('scroll', {
          bubbles: true
        })
      );

      return {
        before,
        after: target.scrollTop,
        maximum,
        atBottom: target.scrollTop >= maximum - 2
      };
    }).catch(() => ({
      before: 0,
      after: 0,
      maximum: 0,
      atBottom: true
    }));

    await page.waitForTimeout(350);

    if (scrollState.atBottom && unchangedRounds >= 3) {
      break;
    }
  }

  return uniqueSorted([...result]);
}

const proxyServer = process.env.PROXY_SERVER?.trim();

const launchOptions = {
  headless: true
};

if (proxyServer) {
  launchOptions.proxy = {
    server: proxyServer,
    username: process.env.PROXY_USERNAME || undefined,
    password: process.env.PROXY_PASSWORD || undefined
  };

  console.log('已启用代理：', proxyServer);
} else {
  console.log('未配置代理，直接访问 DJI 页面');
}

const browser = await chromium.launch(launchOptions);

const context = await browser.newContext({
  locale: 'zh-CN',
  timezoneId: 'Asia/Shanghai',
  viewport: {
    width: 1440,
    height: 1200
  },
  extraHTTPHeaders: {
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5'
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36'
});

await context.addCookies([
  {
    name: 'country',
    value: 'CN',
    domain: '.dji.com',
    path: '/'
  },
  {
    name: 'region',
    value: 'CN',
    domain: '.dji.com',
    path: '/'
  },
  {
    name: 'lang',
    value: 'zh-CN',
    domain: '.dji.com',
    path: '/'
  }
]).catch((error) => {
  console.warn('写入地区 Cookie 失败：', error.message);
});

const page = await context.newPage();

page.setDefaultTimeout(30000);

page.on('console', (message) => {
  console.log(`[网页控制台 ${message.type()}] ${message.text()}`);
});

page.on('pageerror', (error) => {
  console.warn('[网页脚本错误]', error.message);
});

page.on('requestfailed', (request) => {
  console.warn(
    '[请求失败]',
    request.url(),
    request.failure()?.errorText
  );
});

try {
  const response = await page.goto(URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  await page.waitForTimeout(10000);

  await printPageInfo(page, response);
  await saveDebugInfo(page, 'before-dropdown.png');

  await closePossiblePopups(page);
  await page.waitForTimeout(2000);

  if (!page.url().includes('/recycle/apply')) {
    console.warn(
      `警告：页面可能发生地区跳转，最终地址是 ${page.url()}`
    );
  }

  await clickModelDropdown(page);

  await page.waitForTimeout(2000);
  await saveDebugInfo(page, 'dropdown-opened.png');

  const models = await collectDropdownOptions(page);

  console.log('读取到的机型：');
  console.log(models);

  await saveDebugInfo(page, 'latest.png');

  if (models.length < 2) {
    throw new Error(
      `只读取到 ${models.length} 个机型，结果可能不完整：${models.join('、')}`
    );
  }

  const now = new Date().toISOString();

  const current = {
    url: URL,
    finalUrl: page.url(),
    checkedAt: now,
    count: models.length,
    models
  };

  if (!fs.existsSync(SNAPSHOT_FILE)) {
    fs.writeFileSync(
      SNAPSHOT_FILE,
      `${JSON.stringify(current, null, 2)}\n`,
      'utf8'
    );

    fs.writeFileSync(
      SUMMARY_FILE,
      [
        '# DJI 换购机型监控已初始化',
        '',
        `首次记录到 **${models.length}** 个机型。`,
        '',
        ...models.map((item) => `- ${item}`),
        ''
      ].join('\n'),
      'utf8'
    );

    writeOutput('changed', 'false');
    writeOutput('baseline_created', 'true');
    writeOutput('model_count', models.length);

    console.log(`首次运行：已保存 ${models.length} 个机型作为基准。`);
  } else {
    const previous = JSON.parse(
      fs.readFileSync(SNAPSHOT_FILE, 'utf8')
    );

    const oldModels = uniqueSorted(previous.models || []);

    const added = models.filter(
      (item) => !oldModels.includes(item)
    );

    const removed = oldModels.filter(
      (item) => !models.includes(item)
    );

    const changed = added.length > 0 || removed.length > 0;

    const summaryLines = [
      '# DJI 换购机型下拉列表发生变化',
      '',
      `- 检查时间：${now}`,
      `- 页面：${URL}`,
      `- 最终地址：${page.url()}`,
      `- 原数量：${oldModels.length}`,
      `- 新数量：${models.length}`,
      ''
    ];

    if (added.length > 0) {
      summaryLines.push(
        '## 新增机型',
        '',
        ...added.map((item) => `- ${item}`),
        ''
      );
    }

    if (removed.length > 0) {
      summaryLines.push(
        '## 删除或改名的机型',
        '',
        ...removed.map((item) => `- ${item}`),
        ''
      );
    }

    if (!changed) {
      summaryLines.push('本次未检测到变化。', '');
    }

    fs.writeFileSync(
      SUMMARY_FILE,
      summaryLines.join('\n'),
      'utf8'
    );

    writeOutput('changed', changed ? 'true' : 'false');
    writeOutput('baseline_created', 'false');
    writeOutput('model_count', models.length);

    if (changed) {
      fs.writeFileSync(
        SNAPSHOT_FILE,
        `${JSON.stringify(current, null, 2)}\n`,
        'utf8'
      );

      console.log(
        `检测到变化：新增 ${added.length} 个，删除或改名 ${removed.length} 个。`
      );
    } else {
      console.log(`没有变化，当前共 ${models.length} 个机型。`);
    }
  }
} catch (error) {
  console.error('监控运行失败：', error);

  await printPageInfo(page, null).catch(() => {});
  await saveDebugInfo(page, 'error.png');

  throw error;
} finally {
  await browser.close();
}
