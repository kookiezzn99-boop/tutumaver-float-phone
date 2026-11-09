import { loadChatMessages, loadChatSessions } from "./chat-storage";
import { findQuestionBoxConfirmations } from "./question-box-chat";
import { loadBoxState } from "./question-box-storage";

export type QuestionBoxProjectionEntry = { id: string; timestamp: string; content: string; shared?: boolean; authorType: "user" | "character" | "npc" };
const compact = (value: string, limit: number) => value.replace(/\s+/g, " ").trim().slice(0, limit);

/** Derived from live box state: deleting a question or session also removes every associated event. */
export function loadQuestionBoxProjectionEntries(characterId: string, options?: { afterTimestamp?: string }): QuestionBoxProjectionEntry[] {
  const events: QuestionBoxProjectionEntry[] = [];
  const sessions = loadBoxState().sessions.filter(box => box.ownerId === "user" || box.ownerId === characterId);
  const boxes = new Map(sessions.map(box => [box.id, box]));
  const confirmations = new Map<string, string>();
  if (sessions.some(box => box.questions.some(question => question.senderId === (box.ownerId === "user" ? characterId : "user")))) {
    for (const chat of loadChatSessions()) {
      if (chat.isGroup || chat.contactId !== characterId) continue;
      const known = findQuestionBoxConfirmations(loadChatMessages(chat.id), (snapshot, claim) => {
        const box = boxes.get(snapshot.boxId);
        const question = box?.questions.find(row => row.id === snapshot.questionId && row.text === snapshot.question);
        if (!question) return false;
        return claim === "user-asked"
          ? box?.ownerId === characterId && question.senderId === "user"
          : box?.ownerId === "user" && question.senderId === characterId;
      });
      for (const [key, timestamp] of known) {
        if (!confirmations.has(key) || timestamp < confirmations.get(key)!) confirmations.set(key, timestamp);
      }
    }
  }
  const add = (id: string, time: number, content: string, authorType: QuestionBoxProjectionEntry["authorType"], shared?: boolean) => {
    if (!Number.isFinite(time)) return;
    const timestamp = new Date(time).toISOString();
    if (!options?.afterTimestamp || timestamp > options.afterTimestamp) events.push({ id, timestamp, content, authorType, shared });
  };
  for (const box of sessions) {
    if (box.ownerId === characterId) {
      add(`question_box_${box.id}`, box.startsAt, `你开启了一期提问箱${box.topic ? `，主题是「${compact(box.topic, 100)}」` : ""}。`, "character");
    }
    for (const question of box.questions) {
      const confirmedAt = confirmations.get(`${box.id}/${question.id}`);
      if (confirmedAt) {
        const ownBox = box.ownerId === characterId;
        const questionText = compact(question.text, 300);
        const answerText = question.answer && compact(question.answer.original, 500);
        const questionSide = ownBox ? "用户向你的提问箱提问" : "你向用户的提问箱提问";
        const answerSide = ownBox ? "你回答" : "用户回答";
        add(`question_box_confirmed_${question.id}`, Date.parse(confirmedAt),
          `你们在私聊确认了提问箱的身份。${questionSide}：“${questionText}”。`, ownBox ? "user" : "character", true);
        if (question.answer && answerText) add(`question_box_answer_${question.id}`, Math.max(question.answer.createdAt, Date.parse(confirmedAt)),
          `${answerSide}了这条提问箱问题“${questionText}”：“${answerText}”。`, ownBox ? "character" : "user", true);
        continue;
      }
      if (box.ownerId === "user" && question.senderId === characterId) {
        add(`question_box_question_${question.id}`, question.createdAt, `你匿名向用户的提问箱提出了问题：“${compact(question.text, 300)}”。`, "character");
        if (question.answer) add(`question_box_answer_${question.id}`, question.answer.createdAt, `用户回答了你在提问箱里问的问题“${compact(question.text, 220)}”：“${compact(question.answer.original, 500)}”。`, "user");
      }
      if (box.ownerId === characterId) {
        // The sender is deliberately never copied into C's timeline, including for U's delivery.
        add(`question_box_question_${question.id}`, question.createdAt, `你的提问箱收到一条匿名问题：“${compact(question.text, 300)}”。发问者身份未知。`, "npc");
        if (question.answer) add(`question_box_answer_${question.id}`, question.answer.createdAt, `你在提问箱回答了匿名问题“${compact(question.text, 220)}”：“${compact(question.answer.original, 500)}”。`, "character");
      }
    }
  }
  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
