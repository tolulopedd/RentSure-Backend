CREATE TABLE "Conversation" (
 "id" TEXT PRIMARY KEY, "creationKey" TEXT NOT NULL UNIQUE, "subject" TEXT NOT NULL,
 "contextType" TEXT NOT NULL DEFAULT 'NONE', "contextId" TEXT, "contextLabel" TEXT,
 "lastSequence" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE TABLE "ConversationParticipant" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE RESTRICT,
 "actorKey" TEXT NOT NULL, "displayName" TEXT NOT NULL, "role" TEXT NOT NULL,
 "readThrough" INTEGER NOT NULL DEFAULT 0, "archivedAt" TIMESTAMP(3),
 UNIQUE ("conversationId", "actorKey")
);
CREATE INDEX "ConversationParticipant_actorKey_archivedAt_idx" ON "ConversationParticipant"("actorKey", "archivedAt");
CREATE TABLE "ConversationMessage" (
 "id" TEXT PRIMARY KEY, "conversationId" TEXT NOT NULL REFERENCES "Conversation"("id") ON DELETE RESTRICT,
 "senderId" TEXT NOT NULL REFERENCES "ConversationParticipant"("id") ON DELETE RESTRICT,
 "requestKey" TEXT NOT NULL UNIQUE, "sequence" INTEGER NOT NULL, "content" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("conversationId", "sequence")
);
