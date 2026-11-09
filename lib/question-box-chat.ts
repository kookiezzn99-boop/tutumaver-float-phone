import type { ChatMessage } from "./chat-storage";

export type QuestionBoxSnapshot = {
  boxId: string;
  questionId: string;
  question: string;
  answer?: { name: string; original: string; translated: string };
};

const askedByUser = /^(?:嗯[,，]?|对[,，]?)?(?:(?:这(?:条|个)?(?:问题)?)?是)?我问的$/;
const answeredForCharacter = /^(?:这(?:条|个)?(?:回答)?是)?我(?:回答(?:了)?你(?:问的)?(?:那条|的(?:问题)?)?|回你(?:的|那条))的?$/;
const asksCharacter = /^(?:这(?:条|个)?(?:问题)?是)?你问的(?:吗|嘛|吧)?$/;

function plainLines(text: string): string[] {
  return text.split(/[\n|｜]/).map(line => line.replace(/[\s。！!？?]+$/g, "").trim());
}

export function findQuestionBoxConfirmations(messages: ChatMessage[], verify: (snapshot: QuestionBoxSnapshot, claim: "user-asked" | "character-asked") => boolean) {
  const confirmsOwnQuestion = (line: string) => askedByUser.test(line) || /^(?:是|是的|对|对的|没错)$/.test(line);
  const confirmations = new Map<string, string>();
  const cards = new Map<string, QuestionBoxSnapshot>();
  let active: QuestionBoxSnapshot | undefined;
  let pending: QuestionBoxSnapshot | undefined;
  const remember = (snapshot: QuestionBoxSnapshot, claim: Parameters<typeof verify>[1], timestamp: string) => {
    const key = `${snapshot.boxId}/${snapshot.questionId}`;
    if (!confirmations.has(key) && verify(snapshot, claim)) confirmations.set(key, timestamp);
  };
  for (const message of messages) {
    if (message.isRetracted) continue;
    if (message.role === "user") {
      const snapshot = message.mediaType === "app_card" && message.mediaData?.questionBoxSnapshot;
      if (snapshot) {
        cards.set(message.id, snapshot);
        active = snapshot;
        pending = undefined;
        continue;
      }
      const reference = message.mediaData?.quoteMessageId;
      const current = reference ? cards.get(reference) : active;
      active = undefined;
      pending = undefined;
      if (!current || (message.mediaType && message.mediaType !== "quote")) continue;
      const lines = plainLines(message.content);
      if (lines.some(line => askedByUser.test(line) && !/[?？]\s*$/.test(message.content))) remember(current, "user-asked", message.createdAt);
      if (current.answer && lines.some(line => answeredForCharacter.test(line)) && !/[?？]\s*$/.test(message.content)) remember(current, "character-asked", message.createdAt);
      if (lines.some(line => asksCharacter.test(line)) && /[?？吗嘛吧]\s*[?？]?\s*$/.test(message.content)) pending = current;
    } else if (message.role === "assistant") {
      active = undefined;
      const current = pending;
      pending = undefined;
      if (current && (!message.mediaType || message.mediaType === "quote") && plainLines(message.content).some(confirmsOwnQuestion) && !/[?？]\s*$/.test(message.content)) {
        remember(current, "character-asked", message.createdAt);
      }
    }
  }
  return confirmations;
}
