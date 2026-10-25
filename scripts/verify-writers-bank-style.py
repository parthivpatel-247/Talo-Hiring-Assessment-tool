# Every bold / underlined / italic phrase candidates should see is shown with the same emphasis.
# Usage: python3 -I scripts/verify-writers-bank-style.py <file.docx> <bank.json>
import json, sys, docx
from docx.text.paragraph import Paragraph
d = docx.Document(sys.argv[1]); qs = json.load(open(sys.argv[2]))['questions']
allp = '\n'.join(q['prompt'] for q in qs)
skip = ('Model answer', 'Acceptable variations', 'Marking criteria', 'Evaluation guidance', 'Welcome', 'Duration', 'Marks:',
        'Exercise I: Rewrite', 'Task: The text below is the tooltip', 'Tooltip text:')
grader = False; checked = 0; problems = []
def spans(p, attr):
    out, cur = [], ''
    for r in p.runs:
        if getattr(r, attr) and r.text:
            cur += r.text
        else:
            if cur.strip(): out.append(cur.strip())
            cur = ''
    if cur.strip(): out.append(cur.strip())
    return out
paras = [Paragraph(c, d) for c in d.element.body.iter() if c.tag.endswith('}p')]
for p in paras:
    t = p.text.strip()
    if not t: continue
    if t.startswith(('Model answer', 'Acceptable variations', 'Marking criteria', 'Evaluation guidance')): grader = True
    if t.startswith(('Exercise II', 'PART B')): grader = False
    if grader or t.startswith(skip): continue
    # paragraphs inside the grammar table (model answer / explanation columns) are grader-only
    if any(t == x for x in ()): continue
    for s in spans(p, 'bold'):
        heading = p.style.name.startswith('Heading') or s.startswith(('1. Grammar', '2.', '3.', 'Editing', 'Writing'))
        checked += 1
        ok = f'**{s}' in allp or f'{s}**' in allp or (heading and f'#### {s}' in allp) or (s in ('2.', '3.', 'Editing', 'Writing') and '#### ' in allp)
        if not ok: problems.append(('bold', s))
    for s in spans(p, 'underline'):
        checked += 1
        if f'[u]{s}' not in allp and f'{s}[/u]' not in allp: problems.append(('underline', s))
    for s in spans(p, 'italic'):
        checked += 1
        if f'[i]{s}' not in allp: problems.append(('italic', s))
print('emphasis checks:', checked, 'problems:', len(problems))
for pr in problems: print('  ', pr)
