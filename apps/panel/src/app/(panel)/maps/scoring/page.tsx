import { DEFAULT_SCORING, MONUMENT_CHECKLIST, resolveScoring } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { mapsView } from "@/lib/maps";
import { resetMapsScoring, saveMapsScoring } from "../actions";

export const metadata = { title: "Оценка карт" };

const PARTS = [
  ["rt", "РТ из списка", "С учётом веса каждой РТ: нет космодрома — теряется много, нет зиккурата — мало"],
  ["spread", "Расстановка", "Охват четвертей карты, крупные РТ не вплотную друг к другу, безопасные зоны не у топовых РТ"],
  ["terrain", "Рельеф", "Суша, скалы под базы, реки и озёра — относительно остальных карт пула"],
  ["extra", "Насыщенность", "Общее число монументов относительно остальных карт пула"],
] as const;

export default async function MapsScoringPage() {
  await requirePage();
  const { s } = await mapsView();
  const sc = resolveScoring(s.scoring);

  return (
    <>
      <PageHead title="Оценка карт" hint="По оценке автоподбор выбирает лучшие карты из пула, она же показывается в карточках. Биомы не оцениваются: их задаёт сохранённый конфиг RustMaps." />
      <ActionForm action={saveMapsScoring}>
        <Section title="Составляющие" hint="Сколько баллов из 100 даёт каждая часть. В сумме должно быть 100.">
          <div className="tiles group">
            {PARTS.map(([key, label, hint]) => (
              <FieldRow key={key} icon="trending" label={label} hint={`${hint}. По умолчанию ${DEFAULT_SCORING.parts[key]}.`}>
                <NumberInput name={key} defaultValue={sc.parts[key]} min={0} max={100} label={label} />
              </FieldRow>
            ))}
          </div>
        </Section>

        <Section title="Вес РТ" hint="От 0 до 10: насколько РТ популярна и ценна для игроков. РТ с весом от 6 считаются крупными: они участвуют в расстановке и в списке «нет на карте».">
          <div className="tiles group">
            {MONUMENT_CHECKLIST.map(([name]) => (
              <FieldRow key={name} icon="map" label={name} hint={`По умолчанию ${DEFAULT_SCORING.rtWeights[name]}`}>
                <NumberInput name={`w:${name}`} defaultValue={sc.rtWeights[name] ?? 0} min={0} max={10} label={name} />
              </FieldRow>
            ))}
          </div>
        </Section>

        <div className="save-bar" style={{ gap: 8 }}>
          {/* Формы нельзя вкладывать друг в друга: кнопка стоит рядом с «Сохранить», а отправляет форму сброса ниже. */}
          <button type="submit" form="maps-scoring-reset" className="btn secondary">
            Вернуть по умолчанию
          </button>
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>

      <ActionForm id="maps-scoring-reset" action={resetMapsScoring} confirm="Вернуть веса оценки по умолчанию?" confirmLabel="Вернуть" />
    </>
  );
}
