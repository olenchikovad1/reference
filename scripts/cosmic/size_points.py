#!/usr/bin/env python3
"""Мерка из табелей Cosmic: значения по размерам и медиана по табелям.

Так 24.09.2026 снята размерная сетка B-HDY-14 (ширина груди, длина спинки), а
25.09.2026 — длина капюшона для границы опущенного капюшона (план 076,
US-0519). Самого B-HDY-14 в Cosmic нет, поэтому берутся табели похожих
изделий: девичьих толстовок на молнии с капюшоном, у которых заполнен весь
ряд 98–164 (двенадцать табелей на 24.09.2026).

Где: хост, через scripts/cosmic/query.py (туннель, только чтение).

    py scripts/cosmic/size_points.py "длина капюшона"
    py scripts/cosmic/size_points.py "длина по центру спинки"
"""

import pathlib
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from query import run  # noqa: E402

SIZES = ["98", "104", "110", "116", "122", "128", "134", "140", "146", "152", "158", "164"]
NAME = "lower(coalesce(nullif(p.description_ru,''), p.description, p.name))"

#: Толстовки на молнии с капюшоном и полным рядом 98–164 — те же двенадцать, по
#: которым снята сетка: у них есть и капюшон, и молния, и грудь, и спинка.
HOODIES = f"""
with pts as (select p.id, p.master_id, {NAME} as n from size_chart_point p),
hood as (select master_id from pts group by master_id
         having bool_or(n like '%капюшон%') and bool_or(n like '%молни%')
            and bool_or(n like 'ширина груди под проймой%') and bool_or(n like 'длина по центру спинки%')),
full_row as (select h.master_id from hood h join pts p on p.master_id = h.master_id
             join size_chart_point_grades g on g.size_chart_point_id = p.id
             join size sz on sz.id = g.grades_key and sz.name in ({", ".join(f"'{s}'" for s in SIZES)})
             group by h.master_id having count(distinct sz.name) = {len(SIZES)})
select master_id from full_row"""


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    point = sys.argv[1].lower().replace("'", "")
    out = run(f"""
{HOODIES.replace("select master_id from full_row", "")}
select p.master_id, sz.name, g.grades
from size_chart_point p
join size_chart_point_grades g on g.size_chart_point_id = p.id
join size sz on sz.id = g.grades_key
where p.master_id in (select master_id from full_row) and {NAME} like '{point}%'
order by 1, sz.sort_order""")
    values: dict[str, dict[int, float]] = defaultdict(dict)
    for line in out.splitlines():
        cells = [c.strip() for c in line.split("|")]
        if len(cells) == 3 and cells[0].isdigit() and cells[1] in SIZES:
            values[cells[1]][int(cells[0])] = float(cells[2])
    tabels = sorted({m for by in values.values() for m in by})
    print(f"мерка «{point}»: табелей {len(tabels)} ({', '.join(map(str, tabels))})")
    for s in SIZES:
        v = list(values[s].values())
        if v:
            print(f"  {s:>4}: медиана {statistics.median(v):6.2f} см  [{min(v):.2f}..{max(v):.2f}]")


if __name__ == "__main__":
    main()
