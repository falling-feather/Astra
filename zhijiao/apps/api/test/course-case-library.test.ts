import { describe, expect, it } from "vitest";
import { openPGliteContentStore } from "@ronggang/content-store";
import { POSTPUBLICATION_CASE_COURSE, readCourseCaseDossier, seedCourseCaseLibrary } from "../src/course-case-library.js";

describe("published course case dossier", () => {
  it("reads immutable SQL content and isolates teacher notes and observations", async () => {
    const store = await openPGliteContentStore();
    try {
      await seedCourseCaseLibrary(store);
      await seedCourseCaseLibrary(store);
      expect(await store.listCaseReleases()).toHaveLength(1);
      const student = await readCourseCaseDossier(store, POSTPUBLICATION_CASE_COURSE, "student");
      const teacher = await readCourseCaseDossier(store, POSTPUBLICATION_CASE_COURSE, "teacher");
      expect(student?.dossier.studentMaterials).toHaveLength(8);
      expect(student?.dossier.scenarios).toHaveLength(3);
      expect(JSON.stringify(student)).not.toMatch(/teacherOnlyNotes|teacherObservationPoints/);
      expect(teacher?.dossier.teacherOnlyNotes).toHaveLength(3);
      expect(student?.contentHash).toBe(teacher?.contentHash);
      expect(await readCourseCaseDossier(store, "course-village-super-multiplatform", "student")).toBeNull();
      expect(await store.getCaseDraft("unknown-case")).toBeNull();
    } finally { await store.close(); }
  }, 30_000);
});
