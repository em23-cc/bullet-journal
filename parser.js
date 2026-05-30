/* parser.js — 双解析器：规则 + DeepSeek API */

/* ---------- 工具函数 ---------- */

function createId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayKey() {
  return dateKeyFromDate(new Date());
}

function toDateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyFromDate(date) {
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatMonthDay(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(date) {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

function formatDateKey(key) {
  if (!key) return "";
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : formatMonthDay(date);
}

function weekdayIndex(value) {
  return "一二三四五六日天".indexOf(value) % 7;
}

function weekDays() {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = addDays(now, 1 - day);
  return ["一", "二", "三", "四", "五", "六", "日"].map((weekday, index) => {
    const date = addDays(monday, index);
    return { weekday: `周${weekday}`, date, key: dateKeyFromDate(date) };
  });
}

function trimText(value, max) {
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

/* ---------- 规则解析器 ---------- */

const EVENT_NOUNS = /活动|比赛|大赛|考试|讲座|会议|答辩|面试|培训|典礼|晚会|演出|展览|答辩会|宣讲会|招聘会/;
const NOISE_PREFIXES = /请各位同学|各位同学|通知[:：]?|@所有人|温馨提示|提醒|注意/;
const ACTION_SUFFIXES = /开始报名|报名|举行|开展|进行|开始|相关|有关|的|学院|通知/;

const ACTION_RULES = [
  [/报名.*截止|截止.*报名|报送.*截止|登记.*截止/, "报名", "", "•"],
  [/作品.*(?:提交|截止)|提交.*作品|上传.*作品/, "提交", "作品", "•"],
  [/材料.*(?:提交|截止)|提交.*材料|递交.*材料/, "提交", "材料", "•"],
  [/论文.*(?:提交|截止)|提交.*论文/, "提交", "论文", "•"],
  [/报告.*(?:提交|截止)|提交.*报告/, "提交", "报告", "•"],
  [/问卷.*(?:提交|截止)|填写.*问卷|完成.*问卷/, "填写", "问卷", "•"],
  [/提交.*截止|截止.*提交|上传.*截止|交到.*截止|递交/, "提交", "", "•"],
  [/考试|测验|笔试/, "考试", "", "○"],
  [/举行|开始|开展|举办|于.*\d+[:时分]/, "参加", "", "○"],
  [/会议|班会|讲座|答辩|面试|培训|宣讲/, "参加", "", "○"],
  [/集合|签到/, "集合", "", "○"],
  [/截止|截至|ddl|DDL|前$/, "截止", "", "•"],
];

function extractTopic(text) {
  const clauses = text.split(/[。；;！!？?\n]+/).filter(Boolean);
  let best = { text: "", score: -999 };

  for (const clause of clauses) {
    const cleaned = clause
      .replace(NOISE_PREFIXES, "")
      .replace(/^[，,。；;：:\s]+/, "")
      .trim();
    if (!cleaned) continue;

    let score = cleaned.length;
    const timeCount = (cleaned.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}\s*月\s*\d{1,2}|周[一二三四五六日天]/g) || []).length;
    score -= timeCount * 15;
    if (EVENT_NOUNS.test(cleaned)) score += 20;
    if (NOISE_PREFIXES.test(cleaned)) score -= 30;

    if (score > best.score) {
      best = { text: cleaned, score };
    }
  }

  if (!best.text || best.text.length < 2) return "待办事项";

  let topic = best.text
    .replace(/\d{4}[/-]\d{1,2}[/-]\d{1,2}(\s+\d{1,2}[:：]\d{2})?/g, "")
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?(\s*(?:上午|下午|晚上|中午)?\s*\d{1,2}(?:[:：]\d{2}|点(?:\d{1,2}分?)?)?)?/g, "")
    .replace(/[，,。；;：:\s]+/g, " ")
    .trim();

  ACTION_SUFFIXES.lastIndex = 0;
  const parts = topic.split(ACTION_SUFFIXES).filter(Boolean);
  topic = parts[0]?.trim() || topic;

  topic = topic.replace(/\s+/g, "").trim();
  if (!topic || topic.length < 2) return "待办事项";
  return trimText(topic, 18);
}

function classifyAction(context) {
  for (const [pattern, verb, extra, symbol] of ACTION_RULES) {
    if (pattern.test(context)) {
      return { verb, extra, symbol };
    }
  }
  return { verb: "截止", extra: "", symbol: "•" };
}

function buildBulletText(verb, topic, extra) {
  if (!topic || topic === "待办事项") {
    const fallbacks = {
      "报名": "报名相关事项",
      "提交": extra ? `提交${extra}` : "提交相关事项",
      "参加": "参加相关活动",
      "考试": "相关考试",
      "集合": "集合签到",
      "截止": "相关截止事项",
      "填写": extra ? `填写${extra}` : "填写相关事项",
    };
    return fallbacks[verb] || `${verb}相关事项`;
  }

  if (topic.includes(verb)) return topic;

  const templates = {
    "报名": `${verb}${topic}`,
    "提交": extra ? `${verb}${topic}${extra}` : `${verb}${topic}`,
    "参加": `${verb}${topic}`,
    "考试": `${topic}${verb}`,
    "集合": `参加${topic}集合`,
    "截止": `${topic}${verb}`,
    "填写": extra ? `${verb}${topic}${extra}` : `${verb}${topic}`,
  };

  return (templates[verb] || (() => `${verb}${topic}`))();
}

function extractWhens(text) {
  const timePattern =
    /(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:\s+\d{1,2}[:：]\d{2})?|\d{1,2}\s*月\s*\d{1,2}\s*[日号]?(?:\s*(?:上午|下午|晚上|中午)?\s*\d{1,2}(?:[:：]\d{2}|点(?:\d{1,2}分?)?)?)?|(?:本周|下周)?周[一二三四五六日天](?:\s*(?:上午|下午|晚上|中午)?\s*\d{1,2}(?:[:：]\d{2}|点(?:\d{1,2}分?)?)?)?|(?:今天|明天|后天|今晚|明晚)(?:\s*\d{1,2}(?:[:：]\d{2}|点(?:\d{1,2}分?)?)?)?)/g;
  const found = [];
  const seen = new Set();
  let match;

  while ((match = timePattern.exec(text))) {
    const time = cleanTime(match[0]);
    if (!time || seen.has(time)) continue;

    const clauseStart = findClauseStart(text, match.index);
    const clauseEnd = findClauseEnd(text, match.index + match[0].length);
    const context = text.slice(clauseStart, clauseEnd);
    const { verb, extra, symbol } = classifyAction(context);

    found.push({
      time,
      dateKey: inferDateKey(time),
      context,
      verb,
      extra,
      symbol,
    });
    seen.add(time);
  }

  return found;
}

function findClauseStart(text, index) {
  const before = text.slice(0, index);
  const lastBreak = Math.max(
    before.lastIndexOf("，"),
    before.lastIndexOf("。"),
    before.lastIndexOf("；"),
    before.lastIndexOf(";"),
  );
  return lastBreak + 1;
}

function findClauseEnd(text, index) {
  const rest = text.slice(index);
  const candidates = ["，", "。", "；", ";"]
    .map((mark) => rest.indexOf(mark))
    .filter((position) => position >= 0);
  return candidates.length ? index + Math.min(...candidates) : text.length;
}

function cleanTime(value) {
  return value.replace(/\s+/g, "").replace(/[，。；;、]+$/, "");
}

function scoreConfidence(text, whens) {
  let score = 34;
  if (whens.length) score += 28;
  if (whens.length > 1) score += 12;
  if (/提交|截止|截至|前|ddl|DDL|参加|完成|报名|考试|会议/.test(text)) score += 22;
  return Math.min(score, 96);
}

function inferDateKey(value) {
  const now = new Date();
  if (/今天|今晚/.test(value)) return todayKey();
  if (/明天|明晚/.test(value)) return dateKeyFromDate(addDays(now, 1));
  if (/后天/.test(value)) return dateKeyFromDate(addDays(now, 2));

  const full = value.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (full) return toDateKey(Number(full[1]), Number(full[2]), Number(full[3]));

  const monthDay = value.match(/(\d{1,2})\s*月\s*(\d{1,2})/);
  if (monthDay) return toDateKey(now.getFullYear(), Number(monthDay[1]), Number(monthDay[2]));

  const weekDay = value.match(/(本周|下周)?周([一二三四五六日天])/);
  if (weekDay) {
    const base = weekDays()[weekdayIndex(weekDay[2])].date;
    return dateKeyFromDate(addDays(base, weekDay[1] === "下周" ? 7 : 0));
  }

  return todayKey();
}

function parseNoticeRules(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  const whens = extractWhens(normalized);
  const topic = extractTopic(normalized);

  const draftBullets = whens.length
    ? whens.map((item) => ({
        symbol: item.symbol,
        text: buildBulletText(item.verb, topic, item.extra),
        dateKey: item.dateKey,
        timeStr: item.time,
        verb: item.verb,
        extra: item.extra,
      }))
    : [
        {
          symbol: "•",
          text: topic,
          dateKey: todayKey(),
          timeStr: "",
          verb: "",
          extra: "",
        },
      ];

  return {
    bullets: draftBullets,
    confidence: scoreConfidence(normalized, whens),
    source: text,
    parserId: "rules",
  };
}

/* ---------- DeepSeek API 解析器 ---------- */

const DEEPSEEK_SYSTEM_PROMPT = `你是一个子弹笔记解析器。给定一段中文班级/群聊通知，提取所有截止日期和事件，拆成子弹条目。

输出纯 JSON 数组（不要 markdown 代码块），每个元素：
{
  "symbol": "•" 或 "○",
  "text": "自然的中文子弹文本（动词+主题，简洁，不超过20字）",
  "dateKey": "YYYY-MM-DD",
  "timeStr": "可选，具体时间如 18:00"
}

规则：
- • 用于任务/截止类（报名、提交、填写），○ 用于事件类（考试、活动、会议）
- text 要自然：如"报名创新创业活动"而非"创新创业活动报名截止时间"
- 一条通知拆成多条子弹，每条对应一个时间节点
- 提取通知中隐含的截止含义（如"6月1日前报名" = 报名截止 6/1）
- 如果没有明确年份，用今年`;

async function parseNoticeDeepSeek(text, apiKey) {
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`API 请求失败 (${response.status})${err ? "：" + err : ""}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const jsonStr = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const bullets = JSON.parse(jsonStr);

  if (!Array.isArray(bullets)) throw new Error("API 返回格式异常");

  return {
    bullets: bullets.map((b) => ({
      symbol: b.symbol || "•",
      text: b.text || "待办事项",
      dateKey: b.dateKey || todayKey(),
      timeStr: b.timeStr || "",
      verb: "",
      extra: "",
    })),
    confidence: 85,
    source: text,
    parserId: "deepseek",
  };
}

/* ---------- 解析器注册表 ---------- */

const parserRegistry = {
  rules: {
    id: "rules",
    name: "规则解析",
    parse: (text) => Promise.resolve(parseNoticeRules(text)),
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek AI",
    parse(text) {
      const key = localStorage.getItem("bullet-journal-planner:deepseek-key") || "";
      if (!key) throw new Error("请先在设置中填写 DeepSeek API Key");
      return parseNoticeDeepSeek(text, key);
    },
  },
};

function getActiveParserId() {
  return localStorage.getItem("bullet-journal-planner:parser") || "rules";
}

function setActiveParserId(id) {
  localStorage.setItem("bullet-journal-planner:parser", id);
}

function getActiveParser() {
  const id = getActiveParserId();
  return parserRegistry[id] || parserRegistry.rules;
}
