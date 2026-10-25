# Checks that every candidate-facing line of the Word file appears word for word in the
# import file built by build-writers-bank.py (model answers and guidance excluded).
# Usage: python3 -I scripts/verify-writers-bank.py <file.docx> <bank.json>
import json, re, sys, docx
from docx.table import Table
from docx.text.paragraph import Paragraph
d = docx.Document(sys.argv[1]); qs = json.load(open(sys.argv[2]))['questions']
def norm(s):
    s = re.sub(r'\*\*|\[/?u\]', '', s); s = re.sub(r'<br>|&nbsp;|[•◦]|^#+\s*', ' ', s, flags=re.M)
    s = re.sub(r'^\s*(- |\d+\. )', ' ', s, flags=re.M)
    s = s.replace('|', ' ').replace('---', ' ')
    return re.sub(r'\s+', ' ', s).strip()
allp = ' '.join(norm(q['prompt']) for q in qs)
grader_only = ('Model answer', 'Acceptable variations', 'Marking criteria', 'Evaluation guidance')
skip_from = None
missing = []; checked = 0
paras = [Paragraph(c, d) if c.tag.endswith('}p') else Table(c, d) for c in d.element.body.iterchildren() if c.tag.split('}')[1] in ('p','tbl')]
in_grader = False
for item in paras:
    if isinstance(item, Table):
        for r_i, row in enumerate(item.rows):
            cells = [c.text for c in row.cells]
            if cells[0].strip() == '#':
                continue
            if len(cells) == 4:  # grammar table: only the sentence is shown
                texts = [cells[1]]
            else:
                texts = [p.text for c in row.cells for p in c.paragraphs]
            for t in texts:
                if t.strip():
                    checked += 1
                    if norm(t) not in allp: missing.append(t)
        continue
    t = item.text.strip()
    if not t: continue
    if t.startswith(grader_only): in_grader = True; continue
    if t.startswith(('Exercise II', 'PART B')): in_grader = False
    if in_grader: continue
    if t.startswith(('Welcome to the writing test', 'Duration:', 'Marks:')): continue  # overview page
    if t.startswith(('Exercise I: Rewrite a tooltip', 'Task: The text below is the tooltip', 'Tooltip text:')): continue  # reframed on request
    for line in t.split('\n'):
        if line.strip():
            checked += 1
            if norm(line) not in allp: missing.append(line)
print('checked', checked, 'candidate-facing lines; missing:', len(missing))
for m in missing: print('  MISSING:', m)
