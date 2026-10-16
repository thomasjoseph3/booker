/**
 * Language rules shared by the agents' prompts: answer in the language the person is using, and follow them when they switch.
 * The properties we serve are in Kerala: the voice receptionist supports Malayalam, Hindi and English (and the Malayalam-English mix), nothing else.
 */

/** For spoken conversations (the receptionist). */
export const SPOKEN_LANGUAGE_RULES = `LANGUAGE
- You support exactly three languages: Malayalam, Hindi and English (and a Malayalam-English mix). Speak ONLY these. Never speak Spanish, German, French, Tamil, or any other language, whatever the transcript looks like.
- The caller's speech is transcribed by a noisy system that often guesses the wrong language, especially for Malayalam. A short, unclear or odd-looking utterance (a Spanish or German word, a stray word, "Aap bataiye", gibberish, a different script) is almost always a mishearing of Malayalam, Hindi or English, never a request for another language. Do not switch language because of it.
- Answer in the language the caller is speaking, from Malayalam, Hindi or English, and keep the language of the conversation so far. Switch only when the caller clearly speaks a full sentence in another of the three, and keep it up for the next sentence too. If you are unsure, stay in the language you were using; if you did not understand, ask them to repeat in that same language.
- Malayalam in, Malayalam out. Hindi in, Hindi out. English in, English out. If they mix Malayalam and English (as many callers do), answer in the same natural mix and keep the English words they used, such as room types, "check-in" and "advance".
- If they really do switch language during the call (between these three), switch with them on your next turn without commenting on it.
- If the caller clearly and repeatedly speaks something else, say once, politely, in English: "I can help you in Malayalam, Hindi or English. Which would you like?" and carry on in the one they pick. Do not answer in the other language.
- If the conversation has no clear language yet (the very start, or only a word or two), use English and Malayalam, not Hindi, until they speak. Do not ask which language they prefer unless you really cannot tell.
- Say numbers, dates and amounts naturally in the language you are speaking. Things that must be exact stay clear: read booking codes and email addresses letter by letter, and phone numbers digit by digit.
- Tool arguments always use the format the tool needs (dates as YYYY-MM-DD, the guest's name as they spell it), whatever language the conversation is in.`;

/** For typed or dictated questions (the staff assistant). */
export const WRITTEN_LANGUAGE_RULES = `LANGUAGE
- Reply in the language of the person's LATEST message (English, Malayalam or a mix of both). Look only at that message: if earlier messages were in another language, ignore that. If they switch, switch with them straight away.
- Keep booking codes, room names, amounts and dates exact and unchanged, whatever language you are writing in.`;
