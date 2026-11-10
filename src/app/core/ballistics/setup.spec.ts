import { Series } from './model';
import { ammoChipName, sessionSetup } from './setup';

const series = (over: Partial<Series>): Series => ({
  kind: 'normal',
  scopeId: 's1',
  ammoId: 'a1',
  device: 'ДТК Новичок-2',
  pos: 'prone',
  rest: 'bipod',
  ...over,
});

const scopeName = (id: string): string => ({ s1: 'Artelv CRS', s2: 'Тепловизор' })[id] ?? id;

describe('sessionSetup', () => {
  it('puts everything into «Во всех сериях» when the series do not differ', () => {
    const setup = sessionSetup(
      [
        { series: series({}), si: 0 },
        { series: series({ ammoId: 'a2' }), si: 1 },
      ],
      scopeName,
      true,
    );
    expect(setup.common.map((p) => p.text)).toEqual([
      'Artelv CRS',
      'ДТК Новичок-2',
      'лёжа',
      'сошки',
    ]);
    expect(setup.own.get(0)).toEqual([]);
    expect(setup.own.get(1)).toEqual([]);
  });

  it('moves what differs under each card, as on the mockup', () => {
    const setup = sessionSetup(
      [
        { series: series({}), si: 2 },
        { series: series({ device: '', pos: 'stand', rest: 'none' }), si: 3 },
      ],
      scopeName,
      true,
    );
    expect(setup.common).toEqual([{ text: 'Artelv CRS' }]);
    expect(setup.own.get(2)?.map((p) => p.text)).toEqual(['лёжа', 'сошки', 'ДТК Новичок-2']);
    expect(setup.own.get(3)).toEqual([
      { text: 'стоя' },
      { text: 'без опоры' },
      { text: 'без устройства', warn: true },
    ]);
  });

  it('does not mark a missing device on a rifle that has none', () => {
    const setup = sessionSetup([{ series: series({ device: '' }), si: 0 }], scopeName, false);
    expect(setup.common).toContainEqual({ text: 'без устройства' });
  });

  it('shows a differing scope on the cards and leaves out what was never recorded', () => {
    const setup = sessionSetup(
      [
        { series: series({ pos: '', rest: '' }), si: 0 },
        { series: series({ scopeId: 's2', pos: '', rest: '' }), si: 1 },
      ],
      scopeName,
      true,
    );
    expect(setup.common).toEqual([{ text: 'ДТК Новичок-2' }]);
    expect(setup.own.get(1)).toEqual([{ text: 'Тепловизор' }]);
  });
});

describe('ammoChipName', () => {
  it('keeps the brand and the number of a long name', () => {
    expect(ammoChipName('Igla Shakal 160')).toBe('Igla 160');
    expect(ammoChipName('Самосбор 168')).toBe('Самосбор 168');
    expect(ammoChipName('Sellier & Bellot SPCE')).toBe('Sellier & Bellot SPCE');
  });
});
