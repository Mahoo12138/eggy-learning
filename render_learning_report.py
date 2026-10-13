#!/usr/bin/env python3
"""Render the complete learning report as a self-contained, offline HTML file.

Uses only Python's standard library. No network request or dependency installation.
Supported Markdown: headings, paragraphs, lists (including nesting), blockquotes,
fenced code, tables, links/images, emphasis, strikethrough, and horizontal rules.
Raw HTML is escaped. The source Markdown remains the source of truth.

Usage:
  python3 render_learning_report.py
  python3 render_learning_report.py --source report.md --output report.html
  python3 render_learning_report.py --data chart_data.json

Optional JSON overrides DEFAULT_DATA. Statistical charts use the separately
audited jd-skills-data.json and show only the sampled JD counts, never market
shares. To add an evidence-backed company/skill matrix:
  {"matrix": {"caption": "岗位技能对照（案例，不作排名）",
    "columns": ["岗位 / 来源", "明确要求", "优先项", "适配边界"],
    "rows": [["公司 JD01", "C/C++", "项目经验", "毕业窗口待核"]]}}
Text cells are escaped. Put source links and full explanation in the main Markdown.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
from pathlib import Path
import re
from urllib.parse import quote, urlsplit

ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = ROOT / "深圳嵌入式与CPP招聘调研报告-2026-10-12.md"
DEFAULT_OUTPUT = ROOT / "深圳嵌入式与CPP技能训练报告-2028届.html"
DEFAULT_DATA = {
    "title": "深圳嵌入式与 C++ 技能训练手册",
    "subtitle": "面向 2028 届软件工程本科生，把真实岗位要求转成可验证的学习成果。",
    "profile": "2028 届 · 软件工程 · 深圳方向",
    "schedule_note": "32 个训练单元，每单元 4 次、每次 2–3 小时，共 256–384 小时；可按课业顺延，三个项目依次推进。",
    "days": [
        {"label": "第1次", "task": "理解一个概念", "base": 2, "optional": 1},
        {"label": "第2次", "task": "实现一个小功能", "base": 2, "optional": 1},
        {"label": "第3次", "task": "定位并修复错误", "base": 2, "optional": 1},
        {"label": "第4次", "task": "独立验收与复盘", "base": 2, "optional": 1},
    ],
    "timeline": [
        {"date": "单元 1–4", "title": "C 基础验收与补缺", "body": "输入、函数、数组、指针、字符串、固定容量记录与调试；已有能力先验收。"},
        {"date": "单元 5–12", "title": "whatforeating · C TUI", "body": "Windows / CLion：固定菜品表、基础随机、换一个与确认、结果文件，再做 TUI；正式随机策略未定。"},
        {"date": "单元 13–20", "title": "C++ / Linux 终端迷宫", "body": "地图、状态、移动与碰撞；再补存档恢复、Linux 构建调试和资源管理。"},
        {"date": "单元 21–28", "title": "MCU 反应力游戏盒", "body": "同一块板、单 LED 与按钮；非阻塞状态机、消抖、计时和串口记录。"},
        {"date": "单元 29–32", "title": "复测、缓冲与交付", "body": "三个项目依次复测，补独立变式与复现证据；随后只选一条长期主线。"},
        {"date": "2027 下半年至 2028 毕业前", "title": "核对 2028 届岗位", "body": "按届别、到岗条件与当前能力准备实习和校招，不靠追赶单元编号代替验收。"},
        {"date": "2028 毕业后 1–3 年", "title": "承担模块与维护", "body": "按业务积累资源、性能、兼容和现场 / 线上问题经验。"},
    ],
    "matrix": None,
    "companies": [],
    "skillPriorities": [],
}


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def safe_url(value: str) -> str:
    value = value.strip().strip("<>")
    parts = urlsplit(value)
    if parts.scheme and parts.scheme.lower() not in {"http", "https", "mailto", "file"}:
        return "#"
    if value.startswith(str(ROOT) + "/"):
        return quote(str(Path(value).relative_to(ROOT)), safe="/#?=&:%")
    return value


def inline(value: str) -> str:
    tokens: list[str] = []

    def token(rendered: str) -> str:
        tokens.append(rendered)
        return f"\x02{len(tokens) - 1}\x03"

    value = re.sub(r"`([^`\n]+)`", lambda m: token(f"<code>{esc(m[1])}</code>"), value)

    def link(m: re.Match[str]) -> str:
        image, label, href = m[1], m[2], m[3]
        href = safe_url(href)
        if image:
            # The report must remain independent of remote image downloads.
            return token(f'<a href="{esc(href)}">{esc(label or "查看图片")}</a>')
        external = ' target="_blank" rel="noopener noreferrer"' if href.startswith(("https://", "http://")) else ""
        return token(f'<a href="{esc(href)}"{external}>{esc(label)}</a>')

    value = re.sub(r"(!?)\[([^\]\n]+)\]\(([^)\n]+)\)", link, value)
    value = re.sub(r"<(https?://[^>]+)>", lambda m: token(f'<a href="{esc(m[1])}" target="_blank" rel="noopener noreferrer">{esc(m[1])}</a>'), value)
    value = esc(value)
    value = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", value)
    value = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", value)
    value = re.sub(r"~~(.+?)~~", r"<del>\1</del>", value)
    value = re.sub(r"\\([|*_`\[\]\\])", r"\1", value)
    for index in range(len(tokens) - 1, -1, -1):
        value = value.replace(f"\x02{index}\x03", tokens[index])
    return value


def table_cells(line: str) -> list[str]:
    return [cell.strip() for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]


def is_table_rule(line: str) -> bool:
    cells = table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def slug(text: str) -> str:
    text = re.sub(r"[*`~]", "", text).lower()
    return "section-" + (re.sub(r"[^\w\u4e00-\u9fff]+", "-", text).strip("-") or "text")


class Markdown:
    def __init__(self) -> None:
        self.toc: list[tuple[int, str, str]] = []
        self.used_ids: set[str] = set()

    def heading(self, level: int, text: str) -> str:
        key, count = slug(text), 1
        base = key
        while key in self.used_ids:
            count += 1
            key = f"{base}-{count}"
        self.used_ids.add(key)
        if level in (2, 3):
            self.toc.append((level, key, re.sub(r"[*`~]", "", text)))
        return f'<h{level} id="{key}">{inline(text)}</h{level}>'

    def render(self, source: str, sections: bool = False) -> str:
        lines = source.replace("\r\n", "\n").splitlines()
        out: list[str] = []
        i = 0
        section_open = False
        if sections:
            out.append('<section class="report-section report-intro" data-filter-unit>')
            section_open = True
        while i < len(lines):
            text = lines[i]
            if not text.strip():
                i += 1
                continue
            heading = re.match(r"^(#{1,6})\s+(.+?)\s*#*$", text)
            if heading:
                level = len(heading[1])
                if sections and level == 2:
                    if section_open:
                        out.append("</section>")
                    out.append('<section class="report-section" data-filter-unit>')
                    section_open = True
                out.append(self.heading(level, heading[2]))
                i += 1
                continue
            fence = re.match(r"^\s*(`{3,}|~{3,})(.*)$", text)
            if fence:
                code: list[str] = []
                marker, lang = fence[1], fence[2].strip()
                i += 1
                while i < len(lines) and not re.match(r"^\s*" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}\s*$", lines[i]):
                    code.append(lines[i])
                    i += 1
                i += 1
                out.append(f'<pre><code class="language-{esc(lang)}">{esc(chr(10).join(code))}</code></pre>')
                continue
            if re.match(r"^\s*([-*_])(?:\s*\1){2,}\s*$", text):
                out.append("<hr>")
                i += 1
                continue
            if text.lstrip().startswith(">"):
                quoted: list[str] = []
                while i < len(lines) and lines[i].lstrip().startswith(">"):
                    quoted.append(re.sub(r"^\s*>\s?", "", lines[i]))
                    i += 1
                out.append("<blockquote>" + self.render("\n".join(quoted)) + "</blockquote>")
                continue
            if "|" in text and i + 1 < len(lines) and is_table_rule(lines[i + 1]):
                headers = table_cells(text)
                out.append('<div class="table-scroll" tabindex="0" role="region" aria-label="可横向滚动的数据表"><table><thead><tr>')
                out.extend(f'<th scope="col">{inline(cell)}</th>' for cell in headers)
                out.append("</tr></thead><tbody>")
                i += 2
                while i < len(lines) and lines[i].strip() and "|" in lines[i]:
                    cells = table_cells(lines[i])
                    # Do not discard excess cells; malformed source remains visible.
                    out.append('<tr data-route-row>')
                    out.extend(f"<td>{inline(cell)}</td>" for cell in cells)
                    out.append("</tr>")
                    i += 1
                out.append("</tbody></table></div>")
                continue
            item = re.match(r"^(\s*)([-+*]|\d+[.)])\s+(.+)$", text)
            if item:
                indent, ordered = len(item[1]), item[2][0].isdigit()
                tag = "ol" if ordered else "ul"
                number = int(re.match(r"\d+", item[2])[0]) if ordered else 1
                start = f' start="{number}"' if ordered else ""
                out.append(f"<{tag}{start}>")
                while i < len(lines):
                    match = re.match(r"^(\s*)([-+*]|\d+[.)])\s+(.+)$", lines[i])
                    if not match or len(match[1]) != indent or match[2][0].isdigit() != ordered:
                        break
                    chunk = [match[3]]
                    continuation_indent = len(match[1]) + len(match[2]) + 1
                    i += 1
                    while i < len(lines):
                        candidate = lines[i]
                        nxt = re.match(r"^(\s*)([-+*]|\d+[.)])\s+", candidate)
                        if nxt and len(nxt[1]) <= indent:
                            break
                        if not candidate.strip():
                            if i + 1 < len(lines) and len(lines[i + 1]) - len(lines[i + 1].lstrip()) > indent:
                                chunk.append("")
                                i += 1
                                continue
                            # Blank lines between same-level list items are allowed.
                            if i + 1 < len(lines) and re.match(r"^\s*([-+*]|\d+[.)])\s+", lines[i + 1]):
                                i += 1
                            break
                        leading = len(candidate) - len(candidate.lstrip())
                        if leading <= indent:
                            break
                        chunk.append(candidate[min(leading, continuation_indent):])
                        i += 1
                    out.append("<li>" + self.render("\n".join(chunk)) + "</li>")
                out.append(f"</{tag}>")
                continue
            para = [text.strip()]
            i += 1
            while i < len(lines) and lines[i].strip():
                nxt = lines[i]
                if re.match(r"^\s*(#{1,6}\s|>|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s)", nxt):
                    break
                if "|" in nxt and i + 1 < len(lines) and is_table_rule(lines[i + 1]):
                    break
                para.append(nxt.strip())
                i += 1
            out.append("<p>" + inline(" ".join(para)) + "</p>")
        if section_open:
            out.append("</section>")
        return "\n".join(out)


def plan_diagrams(data: dict) -> str:
    days = data["days"]
    base = sum(float(day["base"]) for day in days)
    maximum = base + sum(float(day["optional"]) for day in days)
    if any(float(day["base"]) < 0 or float(day["optional"]) < 0 for day in days):
        raise ValueError("Training hours must be nonnegative")
    max_day = max((float(day["base"]) + float(day["optional"]) for day in days), default=1) or 1
    bars = []
    for day in days:
        solid = float(day["base"]) / max_day * 100
        optional = float(day["optional"]) / max_day * 100
        bars.append(f'''<li class="day"><div class="day-title"><strong>{esc(day['label'])}</strong><span>{float(day['base']):g}–{float(day['base']) + float(day['optional']):g} h</span></div>
            <p>{esc(day['task'])}</p><div class="hour-track" aria-hidden="true"><span class="hour-base" style="width:{solid:g}%"></span><span class="hour-extra" style="width:{optional:g}%"></span></div></li>''')
    timeline = "".join(f'<li><span class="timeline-date">{esc(item["date"])}</span><h3>{esc(item["title"])}</h3><p>{esc(item["body"])}</p></li>' for item in data["timeline"])
    matrix = ""
    if data.get("matrix"):
        mat = data["matrix"]
        headers = "".join(f'<th scope="col">{esc(v)}</th>' for v in mat["columns"])
        rows = "".join('<tr data-route-row>' + "".join(f"<td>{esc(v)}</td>" for v in row) + "</tr>" for row in mat["rows"])
        matrix = f'<section class="overview-section" id="skill-matrix"><h2>{esc(mat["caption"])}</h2><p class="section-note">来自具体岗位的条件对照，不代表公司排名或市场占比。完整来源及适配边界见正文。</p><div class="table-scroll" tabindex="0" role="region" aria-label="技能对照表"><table><thead><tr>{headers}</tr></thead><tbody>{rows}</tbody></table></div></section>'
    company_rows: dict[str, list[str]] = {}
    route_names = {"mcu": "MCU / 单片机", "linux": "嵌入式 Linux", "backend": "C++ 后台", "system": "系统 / 驱动 / 内核", "common": "通用 / 平台未限定"}
    for item in data.get("companies", []):
        skills = item.get("skills", [])
        if isinstance(skills, list):
            skills = "；".join(str(v) for v in skills)
        elif isinstance(skills, dict):
            skills = "；".join(f"{key}：{'、'.join(value) if isinstance(value, list) else value}" for key, value in skills.items())
        href = safe_url(item.get("sourceUrl", "#"))
        group = str(item.get('tier', 'other'))
        company_rows.setdefault(group, []).append(f'''<tr data-company-route="{esc(item.get('route', 'common'))}" data-company-group="{esc(group)}">
          <td><a href="{esc(href)}" target="_blank" rel="noopener noreferrer">{esc(item['company'])}</a><span class="cell-detail">{esc(item.get('size', '规模未核'))}</span></td>
          <td>{esc(route_names.get(item.get('route'), item.get('route', '')))}<span class="cell-detail">{esc(item.get('stage', ''))}</span></td>
          <td>{esc(item.get('learningLevel', '按职位正文核对'))}</td><td>{esc(skills)}</td><td>{esc(item.get('fitNote', ''))}</td></tr>''')
    skill_rows = []
    for item in data.get("skillPriorities", []):
        source_label = esc(item.get("evidence", "正文对应岗位"))
        if item.get("sourceUrl"):
            source_label = f'<a href="{esc(safe_url(item["sourceUrl"]))}" target="_blank" rel="noopener noreferrer">{source_label}</a>'
        skill_rows.append(f'''<tr data-company-route="{esc(item.get('route', 'common'))}"><td>{esc(item['skill'])}</td><td>{esc(item.get('priority', ''))}</td><td>{source_label}</td><td>{esc(item.get('practice', ''))}</td></tr>''')
    if company_rows or skill_rows:
        selectors = '<div class="matrix-filter js-only" hidden><label for="company-route-select">按路线查看</label><select id="company-route-select"><option value="all">全部路线</option>' + ''.join(f'<option value="{key}">{value}</option>' for key, value in route_names.items() if key != 'common') + '</select></div>'
        group_names = {"large": "BOSS 大型组织案例（1000 人以上）", "medium": "BOSS 中型组织案例（100–999 人）", "small": "BOSS 小型组织案例（不足 100 人）", "service": "BOSS 技术服务企业（单列组织形态）", "official": "品牌与平台企业的官方参照（访问状态逐行标注）"}
        grouped_bodies = ''.join(f'<tbody data-company-tier="{esc(group)}"><tr class="company-group-title"><th colspan="5" scope="colgroup">{esc(group_names.get(group, group))}</th></tr>' + ''.join(rows) + '</tbody>' for group, rows in company_rows.items())
        company_table = '<div class="table-scroll" tabindex="0" role="region" aria-label="公司与岗位能力对照"><table><thead><tr><th scope="col">公司 / 规模</th><th scope="col">方向 / 阶段</th><th scope="col">能力侧重</th><th scope="col">技能与条件</th><th scope="col">适配边界</th></tr></thead>' + grouped_bodies + '</table></div>' if company_rows else ''
        skills_table = '<h3>把岗位技能排进训练顺序</h3><p class="section-note">这是学习安排建议，不是技能市场占比或公司的难度评分。</p><div class="table-scroll" tabindex="0" role="region" aria-label="技能训练优先度"><table><thead><tr><th scope="col">技能</th><th scope="col">学习优先度</th><th scope="col">岗位依据</th><th scope="col">练习成果</th></tr></thead><tbody>' + ''.join(skill_rows) + '</tbody></table></div>' if skill_rows else ''
        matrix += f'<section class="overview-section company-comparison" id="company-comparison"><div class="section-heading"><h2>公司与能力，分开判断</h2>{selectors}</div><p class="section-note">本区是精选案例，完整50条统计样本见上方清单。公司规模只描述组织规模；能力侧重来自具体岗位，不能推成排名、录用概率或“越大越难”。含跨届与专项参照，并非当前可投清单。任职、职责、优先项与来源边界逐行保留。</p>{company_table}{skills_table}<p class="section-note matrix-status" id="matrix-status" role="status" aria-live="polite">显示全部已纳入对照的案例。</p></section>'
    if matrix and (ROOT / "visuals.html").exists():
        matrix = '<details class="company-disclosure" id="company-comparison"><summary>查看精选企业与技能案例（含官方补充）</summary>' + matrix.replace(' id="company-comparison"', '') + '</details>'
    result = f'''
    <section class="overview-section dependency" id="learning-map" aria-labelledby="learning-map-title">
      <div class="section-heading"><h2 id="learning-map-title">从基础到可交付的项目</h2><span class="plan-label">学习依赖示意</span></div>
      <p class="section-note">32 个单元依次推进，每单元 4 次、每次 2–3 小时。基础验收后连续完成三个小项目，再依据真实体验选择长期主线。</p>
      <div class="dependency-grid">
        <div class="foundation"><span class="step-period">单元 1–4</span><h3>C 基础验收与补缺</h3><ul><li>函数、数组、字符串、结构体</li><li>指针、固定容量记录与边界</li><li>查错、Git 与记录</li></ul><p class="foundation-note">已会的内容先验收，有证据再跳过。</p></div>
        <div class="route-lanes">
          <div class="route-lane" data-plan-route="common"><span class="route-dot"></span><div><span class="step-period">单元 5–12 · 项目①</span><h3>whatforeating · C TUI</h3><p>Windows / CLion；固定菜品表 → 换一个与确认 → 结果文件与 TUI。</p></div></div>
          <div class="route-lane" data-plan-route="linux"><span class="route-dot"></span><div><span class="step-period">单元 13–20 · 项目②</span><h3>C++ / Linux 终端迷宫</h3><p>地图与状态 → 移动碰撞 → 存档恢复与调试。</p></div></div>
          <div class="route-lane" data-plan-route="mcu"><span class="route-dot"></span><div><span class="step-period">单元 21–28 · 项目③</span><h3>MCU 反应力游戏盒</h3><p>按钮与 LED → 非阻塞状态机 → 消抖计时与串口记录。</p></div></div>
        </div>
        <div class="delivery"><span class="step-period">单元 29–32</span><h3>复测、缓冲与交付</h3><ul><li>记录对应到任务与代码版本</li><li>补反例、延后复测与独立变式</li><li>可复现、能解释、能修改</li></ul><p>实际计划和证据在<a href="学习计划与进度-2028届.html">学习管理页</a>保存。</p></div>
      </div>
      <div class="later-directions"><strong>三个项目之后再选主线</strong><p>MCU 继续练外设与测量；Linux/C++ 在设备应用和后台中选择目标。RTOS、网络、视觉和驱动按需要逐个加入。完整单元安排见<a href="三项目学习训练计划-2028届.md">三项目学习训练计划</a>。</p></div>
    </section>
    <section class="overview-section schedule" id="weekly-rhythm" aria-labelledby="weekly-rhythm-title">
      <div class="section-heading"><h2 id="weekly-rhythm-title">让学习进入每周节奏</h2><span class="plan-label">计划示意，非工时统计</span></div>
      <div class="schedule-intro"><p>{esc(data['schedule_note'])}</p><div class="hours-total"><strong>{base:g}–{maximum:g}</strong><span>小时 / 周</span></div></div>
      <ol class="days">{''.join(bars)}</ol>
      <p class="chart-legend"><span class="legend-solid"></span>基础时段 <span class="legend-extra"></span>可选加时；用于未完成实验、阅读或复盘，不挤占休息。</p>
    </section>
    <section class="overview-section calendar" id="learning-timeline" aria-labelledby="learning-timeline-title">
      <div class="section-heading"><h2 id="learning-timeline-title">从训练单元走向毕业准备</h2><span class="plan-label">2026–2028 准备期与毕业后</span></div>
      <ol class="timeline">{timeline}</ol>
    </section>{matrix}'''
    if (ROOT / "visuals.html").exists():
        # The Canvas replaces the earlier static diagram for interactive readers.
        # Keep the simple diagram available when JavaScript is disabled.
        split = result.index('<section class="overview-section schedule"')
        result = '<noscript>' + result[:split] + '</noscript>' + result[split:]
    return result


def statistical_visuals() -> str:
    """Embed the pinned library, audited data, and interactive visual module."""
    dataset_path = ROOT / "jd-skills-data.json"
    module_path = ROOT / "visuals.html"
    if not dataset_path.exists() and not module_path.exists():
        return ""
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    skills = dataset["skills"]
    jobs = dataset["jobs"]
    skill_ids = {skill["id"] for skill in skills}
    if len(skill_ids) != len(skills) or len({job["id"] for job in jobs}) != len(jobs):
        raise ValueError("Duplicate skill or job IDs in the chart dataset")
    excluded = dataset.get("excluded", [])
    records = jobs + excluded
    tokens = [urlsplit(record["sourceUrl"]).path for record in records]
    if len(set(tokens)) != len(tokens) or len({record["id"] for record in records}) != len(records):
        raise ValueError("Repeated JD identity across included and excluded records")
    population = dataset["methodology"]["population"]
    expected = {"fullBossJds": len(records), "selectedJds": len(jobs), "excludedJds": len(excluded)}
    if any(population[key] != value for key, value in expected.items()):
        raise ValueError("Population declarations disagree with the actual JD records")
    valid_types = {"requirement", "duty", "bonus"}
    stages = {"intern": "实习", "entry": "校招 / 应届 / 1年以内", "experienced": "1–3年"}
    if population["stages"] != {stage: sum(job["stage"] == stage for job in jobs) for stage in stages}:
        raise ValueError("Stage declarations disagree with the actual JD records")
    for job in jobs:
        if job["stage"] not in stages or not job["sourceUrl"].startswith("https://"):
            raise ValueError(f"Invalid stage or source in {job['id']}")
        keys = set()
        for mention in job["mentions"]:
            key = (mention["skill"], mention["type"])
            if mention["skill"] not in skill_ids or mention["type"] not in valid_types or key in keys:
                raise ValueError(f"Invalid or duplicate skill mention in {job['id']}: {key}")
            if not mention.get("evidence"):
                raise ValueError(f"Missing evidence in {job['id']}: {key}")
            keys.add(key)
    # A permanent HTML data table also serves no-JS and print readers.
    headers = "".join(f"<th scope=\"col\">{label}（n={sum(j['stage'] == stage for j in jobs)}）</th>" for stage, label in stages.items())
    rows = []
    for skill in skills:
        cells = []
        for stage in stages:
            count = sum(job["stage"] == stage and any(m["skill"] == skill["id"] and m["type"] == "requirement" for m in job["mentions"]) for job in jobs)
            cells.append(f"<td>{count}</td>")
        rows.append(f"<tr><th scope=\"row\">{esc(skill['label'])}</th>{''.join(cells)}</tr>")
    fallback = f'''<div class="chart-source-table">
      <p class="section-note">下表固定展示全体{len(jobs)}条技术参照样本中“明确任职要求”的提及岗位数，不随上方筛选变化。一个岗位在一格最多计一次；0表示未明确提及。跨届岗位用于技能学习，不表示当前可投。</p>
      <p><a href="{quote('技术栈统计口径.md')}">完整编码口径与排除记录</a> · <a href="jd-skills-data.json">逐JD技能证据数据</a></p>
      <div class="table-scroll" tabindex="0"><table><thead><tr><th scope="col">技能类别</th>{headers}</tr></thead><tbody>{''.join(rows)}</tbody></table></div>
      <noscript><p>启用JavaScript可操作统计图及Canvas路线图；本计数表和完整报告可直接阅读。</p></noscript></div>'''
    library = (ROOT / "vendor/echarts/echarts.min.js").read_text(encoding="utf-8").replace("</script", "<\\/script")
    payload = json.dumps(dataset, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    module = module_path.read_text(encoding="utf-8")
    if '<!-- VISUALS_STATIC_TABLE -->' not in module:
        raise ValueError("Missing static table insertion point in visuals.html")
    module = module.replace('<!-- VISUALS_STATIC_TABLE -->', fallback)
    module = module.replace('@@JD_COUNT@@', str(len(jobs)))
    roster_path = ROOT / "完整50条筛选样本清单-2026-10-12.md"
    roster = Markdown().render(roster_path.read_text(encoding="utf-8"))
    module = module.replace('<!-- VISUALS_ROSTER -->', f'<details class="lv-details" id="full-jd-roster"><summary>查看全部 {len(jobs)} 条筛选样本与来源</summary>{roster}</details>')
    return f'<script>/* Apache ECharts 6.1.0, Apache-2.0; license: vendor/echarts/LICENSE */\n{library}\n</script>\n<script>window.JD_SKILLS_DATA={payload};</script>\n' + module


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--data", type=Path, help="Optional JSON overrides for plan charts; see script docstring")
    args = parser.parse_args()
    data = dict(DEFAULT_DATA)
    if args.data:
        data.update(json.loads(args.data.read_text(encoding="utf-8")))
    source = args.source.read_text(encoding="utf-8")
    md = Markdown()
    body = md.render(source, sections=True)
    toc = "\n".join(f'<a class="toc-depth-{level}" href="#{key}">{esc(label)}</a>' for level, key, label in md.toc)
    modified = dt.datetime.fromtimestamp(args.source.stat().st_mtime, dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
    values = {
        "TITLE": esc(data["title"]), "SUBTITLE": esc(data["subtitle"]),
        "PROFILE": esc(data["profile"]), "TOC": toc, "BODY": body,
        "DIAGRAMS": plan_diagrams(data), "VISUALS": statistical_visuals(), "UPDATED": modified,
        "SOURCE_NAME": esc(args.source.name), "SOURCE_URL": esc(quote(args.source.name)),
        "MATRIX_NAV": '<a href="#company-comparison">公司与技能对照</a>' if data.get("companies") or data.get("skillPriorities") else "",
    }
    page = (ROOT / "learning_report_template.html").read_text(encoding="utf-8")
    for key, value in values.items():
        page = page.replace("@@" + key + "@@", value)
    remaining = re.findall(r"@@[A-Z_]+@@", page)
    if remaining:
        raise ValueError(f"Unresolved template markers: {remaining}")
    args.output.write_text(page, encoding="utf-8")
    print(f"Rendered {args.source.name} -> {args.output.name}")
    print(f"{len(source):,} source characters; {len(md.toc)} section links; {len(page):,} HTML characters")


if __name__ == "__main__":
    main()
