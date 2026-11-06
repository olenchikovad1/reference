# TC-ADOPT-012 — проверенная сводка

TC-2026-11-05 v1.0.0, Reference standard. В reviewed.json опубликована проекция по разрешённому списку полей, а не сырые журналы: результаты, версии и хеши входов, причины выбора, ротация, отпечатки окружений, source commit, точные image IDs, длительности и границы. Значения переменных окружения, зависимости, пути исходников и production inventory исключены. SHA-256 исходных протоколов сохранены; оригиналы остаются локально у исполнителя.

- Исходник146f68cec38d84612e7a8537759f9a2d3c904a8b:85групп/526тестов,0failed/skipped; приёмка кандидата успешна.1093.030сек включает подготовку и gate.
- Реальный replay с теми же85ID, входами и seed20261105:85reused,0executed; новый exact candidate прошёл HTTP gate.60.809сек.
- Контроль: положительный процесс, reuse без второго вызова, отказ после изменения входа; моделируемый конечный обход6групп. Это simulation, не неделя наблюдения.
- Масштабная фикстура: те же13сценариев5000/33000, та же среда,1242.865→58.690сек после ANALYZE. Это одна локальная пара измерений.
- Сохранён хеш первого отказа кандидата InvalidBucketName:85успешных групп не превратили неготовый кандидат в принятую поставку.

Команды выполненного профиля (локальные пути заменены TC_STATE, ACCEPTED, REPLAY):

```sh
python scripts/testing/run.py --stage candidate --image api=sha256:304a7e1dafb8a9d50941189db5556b99fca78f3fe053ccd40766655e9a421fb9 --image web=reference-tc-candidate-web --image tunnel=reference-tc-candidate-tunnel --state-dir TC_STATE --output ACCEPTED --changed scripts/testing/run.py
python scripts/testing/run.py --stage candidate --image api=reference-tc-identical-api --image web=reference-tc-candidate-web --image tunnel=reference-tc-candidate-tunnel --state-dir TC_STATE --output REPLAY --replay ACCEPTED/evidence.json --seed 20261105
python scripts/stand/verify_testing_contract.py --output CONTROL
```

Реальные PostgreSQL/S3 и nginx/API работали в одноразовом приватном Docker-контуре. Production без тестовых записей. Это HTTP-контракт частей, не настоящий межмашинный SSH и не обычный авторизованный браузер через платформу. Чужие sensitive visual-сценарии не присваиваются.

## Поставка пока не завершена

06.11 подтверждено: код TC остаётся в PR29, не в master/production. Оба legacy apply Reference используют force-recreate и не обеспечивают обязательство CONTRACT.md сохранять старый экземпляр до готовности нового. PR оставлен черновиком, чтобы auto-deploy не применил неподтверждённое переключение. Следующий обязательный шаг Reference — корректный rollout обеих частей и стендовая проверка prepare/candidate/switch/verify/drain/restore/discard.

Фоновая ротация передана существующему исполнителю installation через REQ-3e1fce226fcaa37eec13a5b8; доставки, принятия и реального расписания пока нет. Отдельный runner отменён и не нужен. Эти границы не закрываются успешными локальными526тестами.
