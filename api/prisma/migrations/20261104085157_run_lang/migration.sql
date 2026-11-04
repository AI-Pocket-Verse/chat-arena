-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "target_base_url" TEXT NOT NULL,
    "target_label" TEXT,
    "ta_gender" INTEGER NOT NULL,
    "replay_from_run_id" TEXT,
    "persona_set_json" TEXT NOT NULL,
    "user_model" TEXT NOT NULL,
    "judge_model" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'zh',
    "end_condition_json" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "repetitions" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "summary_json" TEXT,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" DATETIME NOT NULL,
    "started_at" DATETIME,
    "finished_at" DATETIME
);
INSERT INTO "new_run" ("concurrency", "created_at", "created_by_id", "created_by_name", "end_condition_json", "finished_at", "id", "judge_model", "name", "persona_set_json", "repetitions", "replay_from_run_id", "started_at", "status", "summary_json", "ta_gender", "target_base_url", "target_label", "user_model") SELECT "concurrency", "created_at", "created_by_id", "created_by_name", "end_condition_json", "finished_at", "id", "judge_model", "name", "persona_set_json", "repetitions", "replay_from_run_id", "started_at", "status", "summary_json", "ta_gender", "target_base_url", "target_label", "user_model" FROM "run";
DROP TABLE "run";
ALTER TABLE "new_run" RENAME TO "run";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
