import asyncio
import json
from pathlib import Path
from lightroom import LightroomClient

async def main():
    async with LightroomClient.connect() as lr:
        current=await lr.develop.get_settings('9C38CAC4-0166-4C0B-A464-6C923C0FFAC1')
        expected=json.loads((Path(__file__).parent/'out/A7S02588/master-settings.json').read_text())
        assert current == expected, 'Lightroom master settings changed'
        print('Lightroom master unchanged')

if __name__ == '__main__': asyncio.run(main())
