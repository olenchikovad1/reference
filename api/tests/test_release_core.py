"""Критический путь выпуска: work v3 и неизменяемость версии через реальный API/БД."""
import httpx

from reference_api.app import create_app


async def test_save_reopen_and_new_version_preserve_original_work() -> None:
    from reference_api.db import engine

    work = {'version': 3, 'coordinateSpace': 'canvas', 'stateCode': 'front',
            'composition': {'selectedId': None, 'elements': []}}
    body = {'name': 'TC-ADOPT-012 synthetic', 'sheet_digest': 'b' * 64,
            'image_digests': [], 'texts': [], 'work': work}
    app = create_app()
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://isolated') as client:
                saved = await client.post('/reference/api/references', json=body)
                assert saved.status_code == 200, saved.text
                identity = saved.json()['id']
                opened = await client.get(f'/reference/api/references/{identity}')
                assert opened.json()['work'] == work
                changed = {**work, 'stateCode': 'back'}
                second = await client.post(f'/reference/api/references/{identity}/versions', json={**body, 'work': changed})
                assert second.status_code == 200, second.text
                assert (await client.get(f'/reference/api/references/{identity}/versions/1')).json()['work'] == work
                assert (await client.get(f'/reference/api/references/{identity}')).json()['work'] == changed
                assert (await client.post(f'/reference/api/references/{identity}/trash')).status_code == 204
    finally:
        await engine.dispose()
