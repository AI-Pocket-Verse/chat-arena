-- CreateTable
CREATE TABLE "persona" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "structured_json" TEXT NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "injected_facts_json" TEXT,
    "recall_probes_json" TEXT,
    "redteam_tactics_json" TEXT,
    "tags" TEXT,
    "archived_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "target_base_url" TEXT NOT NULL,
    "target_label" TEXT,
    "ta_gender" INTEGER NOT NULL,
    "replay_from_run_id" TEXT,
    "persona_set_json" TEXT NOT NULL,
    "user_model" TEXT NOT NULL,
    "judge_model" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "persona_id" TEXT NOT NULL,
    "repetition_index" INTEGER,
    "target_uid" INTEGER,
    "target_memory_id" INTEGER,
    "target_role_id" INTEGER,
    "target_token" TEXT,
    "status" TEXT NOT NULL,
    "end_reason" TEXT,
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "avg_score" REAL,
    "created_at" DATETIME NOT NULL,
    "finished_at" DATETIME,
    CONSTRAINT "session_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "run" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "turn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "user_text" TEXT NOT NULL,
    "target_text" TEXT NOT NULL,
    "target_message_id" INTEGER,
    "target_session_id" TEXT,
    "first_token_ms" INTEGER,
    "total_ms" INTEGER,
    "error_type" TEXT,
    "reply_len" INTEGER,
    "raw_meta_json" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "turn_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "turn_score" (
    "turn_id" TEXT NOT NULL PRIMARY KEY,
    "dims_json" TEXT NOT NULL,
    "overall" REAL NOT NULL,
    "comment" TEXT NOT NULL,
    "improvement_suggestion" TEXT NOT NULL,
    "violation" BOOLEAN NOT NULL DEFAULT false,
    "memory_hit" BOOLEAN,
    "judge_error" TEXT,
    CONSTRAINT "turn_score_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "turn" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memory_check" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "fact_key" TEXT NOT NULL,
    "fact_value" TEXT NOT NULL,
    "inject_turn" INTEGER NOT NULL,
    "probe_turn" INTEGER NOT NULL,
    "injected" BOOLEAN NOT NULL,
    "recalled" BOOLEAN NOT NULL,
    "evidence_text" TEXT
);

-- CreateTable
CREATE TABLE "report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "json" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_by_name" TEXT,
    "created_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "session_run_id_idx" ON "session"("run_id");

-- CreateIndex
CREATE INDEX "turn_session_id_idx" ON "turn"("session_id");

-- CreateIndex
CREATE INDEX "memory_check_session_id_idx" ON "memory_check"("session_id");

-- CreateIndex
CREATE INDEX "report_run_id_idx" ON "report"("run_id");
