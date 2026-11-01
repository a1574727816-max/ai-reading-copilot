import type {
  DocumentContext,
  DocumentSection,
  SelectionContext,
} from "../types";
import { normalize } from "../utils";
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9_]+|[\u3400-\u9fff]+/g) || [];
  return words.flatMap((word) =>
    /^[\u3400-\u9fff]+$/.test(word)
      ? word.length === 1
        ? [word]
        : Array.from({ length: word.length - 1 }, (_, i) =>
            word.slice(i, i + 2),
          )
      : [word],
  );
}
export function retrieve(
  doc: DocumentContext,
  query: string,
  budget = 12000,
  selection?: SelectionContext,
): DocumentSection[] {
  const terms = [...new Set(tokenize(query + " " + (selection?.text || "")))];
  const tokens = doc.sections.map((s) =>
    tokenize(s.headingPath.join(" ") + " " + s.content),
  );
  const avg =
    tokens.reduce((n, t) => n + t.length, 0) / Math.max(1, tokens.length);
  const dfs = new Map(
    terms.map((t) => [t, tokens.filter((a) => a.includes(t)).length]),
  );
  const ranked = doc.sections
    .map((section, i) => {
      let score = 0;
      const list = tokens[i];
      for (const term of terms) {
        const tf = list.filter((t) => t === term).length;
        if (tf) {
          const df = dfs.get(term) || 0;
          const idf = Math.log(1 + (tokens.length - df + 0.5) / (df + 0.5));
          score +=
            (idf * (tf * 2.2)) /
            (tf + 1.2 * (0.25 + (0.75 * list.length) / (avg || 1)));
        }
      }
      if (
        selection &&
        normalize(section.content).includes(normalize(selection.text))
      )
        score += 20;
      return { i, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const chosen = new Set<number>();
  let used = 0;
  for (const { i } of ranked) {
    if (chosen.size >= 10) break;
    for (const n of [i, i - 1, i + 1]) {
      const s = doc.sections[n];
      if (!s || chosen.has(n) || used + s.content.length > budget) continue;
      chosen.add(n);
      used += s.content.length;
    }
  }
  return [...chosen].sort((a, b) => a - b).map((i) => doc.sections[i]);
}
export function splitBatches(
  sections: DocumentSection[],
  budget: number,
): DocumentSection[][] {
  const batches: DocumentSection[][] = [];
  let batch: DocumentSection[] = [],
    size = 0;
  for (const section of sections) {
    if (batch.length && size + section.content.length > budget) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(section);
    size += section.content.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function isOverview(question: string) {
  return /概括|总结|摘要|主要讲|讲了什么|概览|全文|summari[sz]|overview|main (idea|topic)/i.test(
    question,
  );
}
