import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
async function moduleAt(path) {
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(await readFile(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { module, exports: module.exports, Intl, Date, console },
  );
  return module.exports;
}
const { calculateDeadline } = await moduleAt("src/crm/phase4/deadlines.ts");
const { fromOfficeInput, officeInput, monthBounds, monthDays } = await moduleAt(
  "src/crm/phase4/time.ts",
);
test("CPC exclui começo, inclui vencimento, pula fim de semana e feriado informado", () => {
  assert.equal(calculateDeadline("2030-03-01", 1).dueDate, "2030-03-04");
  assert.equal(
    calculateDeadline("2030-03-01", 1, ["2030-03-04"]).dueDate,
    "2030-03-05",
  );
  assert.equal(calculateDeadline("2030-03-02", 1).dueDate, "2030-03-05");
});
test("suspensão CPC 20/12 a 20/01 é inclusiva; DJE calcula publicação antes da contagem", () => {
  assert.equal(calculateDeadline("2026-12-18", 1).dueDate, "2027-01-21");
  assert.equal(calculateDeadline("2027-01-20", 1).dueDate, "2027-01-21");
  const dje = calculateDeadline("2030-03-01", 1, [], "dje");
  assert.equal(dje.effectiveStart, "2030-03-04");
  assert.equal(dje.dueDate, "2030-03-05");
  assert.equal(
    calculateDeadline("2026-12-18", 1, [], "dje").dueDate,
    "2027-01-21",
  );
});
test("data impossível e limites da calculadora são rejeitados", () => {
  for (const value of ["2030-02-30", "not-a-date", "2030-13-01"])
    assert.throws(() => calculateDeadline(value, 1));
  for (const value of [0, -1, 366, 1.5, NaN])
    assert.throws(() => calculateDeadline("2030-03-01", value));
  assert.throws(() => calculateDeadline("2030-03-01", 1, ["2030-02-30"]));
});
test("horário de São Paulo independe do fuso do processo; calendário suporta ano bissexto", () => {
  assert.equal(fromOfficeInput("2030-03-04T09:00"), "2030-03-04T12:00:00.000Z");
  assert.equal(officeInput("2030-03-04T02:00:00.000Z"), "2030-03-03T23:00");
  assert.equal(monthBounds("2030-03").end, "2030-04-01T03:00:00.000Z");
  assert.equal(monthDays("2028-02").filter(Boolean).length, 29);
  assert.throws(() => fromOfficeInput("2030-02-30T09:00"));
});
