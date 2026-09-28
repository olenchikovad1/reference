"""Настоящая Whisper на фразе дела (US-0512) — тяжёлый: грузит модель.

Гоняется в конце плана вместе с остальными тяжёлыми, не в цикле истории.
Фраза — из предварительного набора синтезатора (scripts/voice/synth_phrases.py).
"""

import pathlib

from reference_api.services import voice

PHRASE = pathlib.Path("/srv/reference/files/voice/synthetic/02.wav")


def test_whisper_hears_the_article_as_it_is_written() -> None:
    text, seconds = voice.transcribe(PHRASE.read_bytes())
    assert "Об. 268" in text and "кокетк" in text.lower(), text
    assert 2 < seconds < 10
