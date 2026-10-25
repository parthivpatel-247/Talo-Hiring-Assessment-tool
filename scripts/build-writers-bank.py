"""Build the writers question bank from the team's Word file, word for word.

Candidate-facing text (prompt) is copied exactly; only presentation markup is added
(#### headings in their own case, **bold**, [u]underline[/u] and [i]italic[/i] as in the file, lists, tables).
Model answers, acceptable variations, explanations and marking criteria go into
referenceAnswer / guidance, which never reach the candidate's browser.
Usage: python3 -I build_bank.py <docx> <out.json>
"""
import json, sys
import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

d = docx.Document(sys.argv[1])

def runs(p, bold=True, underline=True):
    out = ''
    for r in p.runs:
        t = r.text
        if not t:
            continue
        if underline and r.underline:
            t = '[u]' + t + '[/u]'
        if bold and r.bold and t.strip():
            lead = t[:len(t) - len(t.lstrip())]
            trail = t[len(t.rstrip()):]
            t = lead + '**' + t.strip() + '**' + trail
        out += t
    # merge adjacent bold runs: "**a****b**" -> "**ab**"
    while '****' in out:
        out = out.replace('****', '')
    return out

def level(p):
    pPr = p._p.pPr
    if pPr is not None and pPr.numPr is not None:
        il = pPr.numPr.ilvl
        return int(il.val) if il is not None else 0
    return None

items = []
for child in d.element.body.iterchildren():
    tag = child.tag.split('}')[1]
    if tag == 'p':
        items.append(('p', Paragraph(child, d)))
    elif tag == 'tbl':
        items.append(('t', Table(child, d)))

paras = [x for k, x in items if k == 'p']
tables = [x for k, x in items if k == 't']
text = [p.text for p in paras]

def find(prefix, start=0):
    for i in range(start, len(paras)):
        if paras[i].text.strip().startswith(prefix):
            return i
    raise KeyError(prefix)

questions = []

# ---------------- Part 1 · Question 1: Grammar & Language (one question per sentence) ----------
q1_intro_par = paras[find('The following sentences are verbose')]
intro_lines = [l.strip() for l in q1_intro_par.text.split('\n') if l.strip()]
assert intro_lines[0].startswith('The following sentences are verbose'), intro_lines
assert intro_lines[1] == 'Note: Usage of AI tool is not allowed here.', intro_lines
grammar_intro = intro_lines[0]
grammar_note = intro_lines[1]
gtab = tables[0]
assert [c.text.strip() for c in gtab.rows[0].cells] == ['#', 'Sentence', 'Model answer', 'Explanation']
for row in gtab.rows[1:]:
    num, sentence, model, explanation = [c.text.strip() for c in row.cells]
    prompt = (
        '#### 1. Grammar & Language\n\n'
        f'{grammar_intro}\n\n'
        f'**{grammar_note}**\n\n'
        '| Sentence |\n| --- |\n'
        f'| {sentence} |'
    )
    questions.append({
        'part': 1, 'prompt': prompt, 'marks': 1, 'wordLimit': 50,
        'referenceAnswer': f'Model answer: {model}',
        'guidance': f'Explanation: {explanation}\nThe model answer is one acceptable version. Accept any answer that shortens and corrects the sentence the same way without losing meaning or an important detail.',
        '_key': f'Grammar sentence {num}',
    })

# ---------------- Part 1 · Question 2: Editing, Exercise I and II ----------------
def block(start_prefix, stop_prefixes):
    i = find(start_prefix)
    out = []
    j = i
    while j < len(paras):
        t = paras[j].text.strip()
        if j > i and any(t.startswith(s) for s in stop_prefixes):
            break
        out.append(paras[j]); j += 1
    return out

def md_lines(ps):
    lines = []
    for p in ps:
        t = runs(p).strip()
        if not t:
            continue
        lv = level(p)
        if lv is not None:
            lines.append(('  ' * lv) + '- ' + t)
        else:
            lines.append(t)
    return lines

def join_paragraphs(lines):
    # blank line between paragraphs; consecutive list items stay together
    out = []
    for l in lines:
        is_li = l.lstrip().startswith('- ')
        if out and not (is_li and out[-1].lstrip().startswith('- ')):
            out.append('')
        out.append(l)
    return '\n'.join(out)

def note_line(p):
    # Shown as an ordinary italic line, as in the file (not as a "Note" label row).
    t = p.text.strip()
    assert t.startswith('Note:'), t
    italic = all(r.italic for r in p.runs if r.text.strip())
    return f'[i]{t}[/i]' if italic else t

# Exercise I
ex1 = block('Exercise I: Rewrite a tooltip', ['Model answer'])
ex1_lines = [runs(p).strip() for p in ex1 if p.text.strip() and not p.text.strip().startswith('Note:')]
ex1_note = [note_line(p) for p in ex1 if p.text.strip().startswith('Note:')][0]
# Exercise I reframed at the writing team's request (2026-10-25): there is no existing
# tooltip to rewrite; candidates write the one-line tooltip from the context.
# Only the title and the Task line change; the "Tooltip text" placeholder is removed.
TITLE_OLD = '**Exercise I: Rewrite a tooltip** (5 marks)'
TITLE_NEW = '**Exercise I: Write a tooltip** (5 marks)'
TASK_NEW = ('**Task:** Using the context above, write the tooltip that appears when users hover over the '
            '**Run Now** button. Make sure it is accurate, clear, and relevant, and follows technical writing best practices.')
assert ex1_lines[0] == TITLE_OLD, ex1_lines[0]
assert ex1_lines[2].startswith('**Task:**') and ex1_lines[3].startswith('**Tooltip text:**'), ex1_lines[2:4]
ex1_lines = [TITLE_NEW, ex1_lines[1], TASK_NEW]
prompt = '#### 2. Editing\n\n' + '\n\n'.join(ex1_lines) + '\n\n' + ex1_note
i = find('Model answer', find('Exercise I'))
model1 = paras[i].text.replace('Model answer:', '').strip()
i_var = find('Acceptable variations', i)
i_crit = find('Marking criteria', i_var)
variations = [paras[k].text.strip() for k in range(i_var + 1, i_crit) if paras[k].text.strip()]
crit_end = find('Exercise II', i_crit)
criteria = [paras[k].text.strip() for k in range(i_crit + 1, crit_end) if paras[k].text.strip()]
questions.append({
    'part': 1, 'prompt': prompt, 'marks': 5, 'wordLimit': 50,
    'referenceAnswer': 'Model answer: ' + model1 + '\nAcceptable variations:\n' + '\n'.join('- ' + v for v in variations),
    'guidance': 'Marking criteria:\n' + '\n'.join('- ' + c for c in criteria),
    '_key': 'Editing Exercise I (tooltip)',
})

# Exercise II
ex2 = block('Exercise II: Write an alert message', ['Model answer'])
ex2_lines = [runs(p).strip() for p in ex2 if p.text.strip() and not p.text.strip().startswith('Note:')]
ex2_note = [note_line(p) for p in ex2 if p.text.strip().startswith('Note:')][0]
prompt = '#### 2. Editing\n\n' + '\n\n'.join(ex2_lines) + '\n\n' + ex2_note
i = find('Model answer', find('Exercise II'))
model2 = paras[i].text.replace('Model answer:', '').strip()
guid2 = paras[find('Evaluation guidance', i)].text.strip()
questions.append({
    'part': 1, 'prompt': prompt, 'marks': 5, 'wordLimit': 100,
    'referenceAnswer': 'Model answer: ' + model2,
    'guidance': guid2,
    '_key': 'Editing Exercise II (alert message)',
})

# ---------------- Part 2 · Question 3: Writing (with the Alerts PRD) ----------------
i_b = find('PART B')
i_prd = find('Alerts PRD', i_b)
task = md_lines(paras[i_b + 1:i_prd])
# "**3. Writing** (20 marks)" -> heading
assert paras[i_b + 1].text.strip().startswith('3. Writing'), paras[i_b + 1].text
task[0] = '#### 3. Writing (20 marks)'
prd = ['## Alerts PRD']
k = i_prd + 1
num = 0
bg_mode = False
while k < len(paras):
    p = paras[k]
    t = runs(p).strip()
    style = p.style.name
    if not p.text.strip():
        k += 1; continue
    if style == 'Heading 2':
        prd.append('#### ' + p.text.strip())
        bg_mode = p.text.strip().startswith('Background')
    elif level(p) is not None:
        if bg_mode and level(p) == 0:
            num += 1
            prd.append(f'{num}. {t}')
        else:
            prd.append(('  ' * level(p)) + '- ' + t)
    else:
        prd.append(t)
    k += 1

# User Stories table: acceptance criteria lines joined with <br>, bullets as • and ◦
ust = tables[1]
rows = []
for r in ust.rows:
    cells = []
    for c in r.cells:
        parts = []
        for p in c.paragraphs:
            t = runs(p, bold=False).strip()
            if not t:
                continue
            lv = level(p)
            if lv is None:
                parts.append(t)
            elif lv == 0:
                parts.append('• ' + t)
            else:
                parts.append('&nbsp;&nbsp;&nbsp;&nbsp;◦ ' + t)
        cells.append('<br>'.join(parts))
    rows.append(cells)
assert rows[0] == ['User Story', 'Acceptance Criteria'], rows[0]
table_md = ['| ' + ' | '.join(rows[0]) + ' |', '| --- | --- |'] + ['| ' + ' | '.join(r) + ' |' for r in rows[1:]]

prompt = '**PART B**\n\n' + join_paragraphs(task) + '\n\n' + join_paragraphs(prd) + '\n\n' + '\n'.join(table_md)
questions.append({
    'part': 2, 'prompt': prompt, 'marks': 20, 'wordLimit': 2000,
    'referenceAnswer': '',
    'guidance': 'No model answer. Grade the outline against the task and the four checks the question lists (relevance, accuracy against the PRD, language, level of detail). Reward good questions for the Product Manager about gaps or unclear points in the PRD.',
    '_key': 'Writing (Alerts PRD outline)',
})

json.dump({'questions': questions}, open(sys.argv[2], 'w'), ensure_ascii=False, indent=2)
print(len(questions), 'questions;', sum(q['marks'] for q in questions if q['part'] == 1), 'marks in Part 1,',
      sum(q['marks'] for q in questions if q['part'] == 2), 'in Part 2;', 'longest prompt', max(len(q['prompt']) for q in questions), 'chars')
