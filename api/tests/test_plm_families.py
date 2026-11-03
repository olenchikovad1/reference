"""Живой состав семьи PLM и собственные исключения; только тестовая БД."""
from types import SimpleNamespace

from reference_api.db import session_factory
from reference_api.models.references import Reference, ReferenceVersion
from reference_api.services import plm, references
from tests.test_assistant import client as client, bot_bearer


async def test_live_family_exclusions_and_new_colours_preserve_versions(client, monkeypatch):
    rows = [plm._colorway({'id': key, 'style_id': 'style-1', 'style_code': '2027', 'color': colour})
            for key, colour in [('cw-1', 'WHITE'), ('cw-2', 'BLACK')]]
    async def colours(*args, **kwargs):
        assert kwargs['drop'] == 'AW26'
        return rows
    async def palette(*args, **kwargs):
        return []
    monkeypatch.setattr(plm, 'list_colorways', colours)
    monkeypatch.setattr(plm, 'list_colors', palette)
    monkeypatch.setattr(references, 'settings', lambda: SimpleNamespace(plm_base_url='http://source', plm_machine_key='local-test'))
    work = {'version': 2, 'plm': {'colorwayId': 'cw-1', 'productCode': 'B-HDY-14', 'dropCode': 'AW26'},
            'composition': {'elements': []}, 'colourCode': 'WHITE'}
    async with session_factory() as db:
        assert db.bind.url.database.endswith('_test')
        card = Reference(name='one PLM family')
        db.add(card); await db.flush()
        ref = card.id
        db.add(ReferenceVersion(reference_id=ref, number=1, sheet_digest='a'*64, image_digests=[], work=work))
        await db.commit()
    headers = bot_bearer('references:view', 'references:write')
    url = f'/reference/api/references/{ref}/plm-family'
    result = await client.get(url, headers=headers)
    assert result.status_code == 200, result.text
    family = result.json()
    assert family['style_id'] == 'style-1'
    assert [c['colorway_id'] for c in family['colours']] == ['cw-1', 'cw-2']
    for _ in range(2):
        assert (await client.post(url+'/cw-2/exclude', headers=headers)).status_code == 204
    assert (await client.post(url+'/cw-1/exclude', headers=headers)).status_code == 422
    assert (await client.post(url+'/foreign/include', headers=headers)).status_code == 422
    assert (await client.post(url+'/cw-2/include', headers=bot_bearer('references:view'))).status_code == 404
    family = (await client.get(url, headers=headers)).json()
    assert family['colours'][1]['in_family'] is False
    rows.append(plm._colorway({'id': 'cw-3', 'style_id': 'style-1', 'style_code': '2027', 'color': 'RED'}))
    family = (await client.get(url, headers=headers)).json()
    assert family['colours'][2]['in_family'] is True
    assert (await client.post(url+'/cw-2/include', headers=headers)).status_code == 204
    assert all(c['in_family'] for c in (await client.get(url, headers=headers)).json()['colours'])
    changed = {**work, 'plm': {**work['plm'], 'dropCode': 'different-drop'}}
    refused = await client.post(f'/reference/api/references/{ref}/versions', headers=headers,
                               json={'name': 'wrong family', 'sheet_digest': 'b'*64, 'work': changed})
    assert refused.status_code == 422, refused.text
    from sqlalchemy import select
    async with session_factory() as db:
        versions = (await db.scalars(select(ReferenceVersion).where(ReferenceVersion.reference_id == ref))).all()
        assert len(versions) == 1 and versions[0].work == work
