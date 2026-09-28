#!/usr/bin/env python3
"""Предварительный набор фраз для замера расшифровки — синтезатором Windows.

Набора, записанного владельцем, пока нет (US-0512, открытый вопрос плана
075). Без набора качество не названо числом вовсе, поэтому до него — этот:
голос Microsoft Irina, 16 кГц моно, фразы дела. Число по нему
**предварительное**: синтезатор говорит чище человека, и настоящая доля
ошибок будет выше. Набор владельца ложится рядом тем же форматом
(`infra/stand/files/voice/<набор>/phrases.json` и файлы) и меряется тем же
`measure_wer.py`.

Где: хост Windows, одна стандартная библиотека (синтезатор — System.Speech
через PowerShell).

    py scripts/voice/synth_phrases.py
"""

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "infra/stand/files/voice/synthetic"
VOICE = "Microsoft Irina Desktop"

#: say — что произносится; write — как это пишут в замечании. Замер
#: сверяет с write: «Об. 268» цифрами, «2 см» — как в работе.
PHRASES = [
    ("танк сдвинь левее на два сантиметра, надпись чуть меньше", "танк сдвинь левее на 2 см, надпись чуть меньше"),
    ("Об двести шестьдесят восемь поставить выше кокетки", "Об. 268 поставить выше кокетки"),
    ("цвет надписи по пантону, темно-синий", "цвет надписи по пантону, темно-синий"),
    ("принт на капюшоне уменьшить на один сантиметр", "принт на капюшоне уменьшить на 1 см"),
    ("кокетка перекрывает ракету, опусти принт ниже", "кокетка перекрывает ракету, опусти принт ниже"),
    ("шрифт надписи толще, линии слишком тонкие для печати", "шрифт надписи толще, линии слишком тонкие для печати"),
    ("поменяй пантон на красный, как у логотипа", "поменяй пантон на красный, как у логотипа"),
    ("ракету повернуть на пять градусов вправо", "ракету повернуть на 5 градусов вправо"),
    ("надпись Об двести шестьдесят восемь сделать белой", "надпись Об. 268 сделать белой"),
    ("на спине принт по центру, на груди поменьше", "на спине принт по центру, на груди поменьше"),
    ("уведи принт с кокетки, шов режет картинку", "уведи принт с кокетки, шов режет картинку"),
    ("танк крупнее, а снежинки убрать совсем", "танк крупнее, а снежинки убрать совсем"),
]

PS = r"""
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 $args[0] | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice($args[1])
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($i in $items) { $s.SetOutputToWaveFile($i.path, $fmt); $s.Speak($i.say) }
$s.SetOutputToNull()
"""


def main() -> None:
    if sys.platform != "win32":
        sys.exit("нужен Windows: синтезатор — System.Speech")
    OUT.mkdir(parents=True, exist_ok=True)
    items = [{"file": f"{n:02}.wav", "say": say, "write": write} for n, (say, write) in enumerate(PHRASES, 1)]
    job = OUT / "_job.json"
    job.write_text(json.dumps([{"path": str(OUT / i["file"]), "say": i["say"]} for i in items], ensure_ascii=False),
                   encoding="utf-8")
    script = OUT / "_synth.ps1"
    script.write_text(PS, encoding="utf-8-sig")
    try:
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), str(job), VOICE],
                       check=True)
    finally:
        job.unlink(missing_ok=True)
        script.unlink(missing_ok=True)
    about = {"about": "Предварительный набор: синтезатор Windows (голос Microsoft Irina), не человек. "
                      "Сделан scripts/voice/synth_phrases.py; сверяется с write.",
             "voice": VOICE, "phrases": [{"file": i["file"], "write": i["write"]} for i in items]}
    (OUT / "phrases.json").write_text(json.dumps(about, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(items)} фраз → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
