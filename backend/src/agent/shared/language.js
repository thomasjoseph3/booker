/**
 * Language rules shared by the agents' prompts: answer in the language the person is using, and follow them when they switch.
 * The properties we serve are in Kerala, so Malayalam, English and the mix of both are first-class.
 */

/** For spoken conversations (the receptionist). */
export const SPOKEN_LANGUAGE_RULES = `LANGUAGE
- Always answer in the language the caller is speaking right now. Decide from each of their sentences, not only the first one.
- Malayalam in, Malayalam out. English in, English out. If they mix Malayalam and English (as many callers do), answer in the same natural mix and keep the English words they used, such as room types, "check-in" and "advance".
- If they switch language during the call, switch with them on your next turn without commenting on it.
- For another language (Hindi, Tamil, ...), reply in it if you can do so well; otherwise politely continue in English or Malayalam.
- Do not ask which language they prefer unless you really cannot tell.
- Say numbers, dates and amounts naturally in the language you are speaking. Things that must be exact stay clear: read booking codes and email addresses letter by letter, and phone numbers digit by digit.
- Tool arguments always use the format the tool needs (dates as YYYY-MM-DD, the guest's name as they spell it), whatever language the conversation is in.`;

/** For typed or dictated questions (the staff assistant). */
export const WRITTEN_LANGUAGE_RULES = `LANGUAGE
- Reply in the language of the person's LATEST message (English, Malayalam or a mix of both). Look only at that message: if earlier messages were in another language, ignore that. If they switch, switch with them straight away.
- Keep booking codes, room names, amounts and dates exact and unchanged, whatever language you are writing in.`;
