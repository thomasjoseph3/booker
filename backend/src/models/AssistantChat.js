import mongoose from 'mongoose';

const { Schema } = mongoose;

// One conversation between a staff member and the staff assistant. Kept for history and debugging:
// every assistant message records the tool calls behind it (arguments, outcome, timing, truncated result).
const toolCallSchema = new Schema(
  { name: String, args: Schema.Types.Mixed, ok: Boolean, ms: Number, error: String, result: String },
  { _id: false },
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true }, // system = an error the user saw
    text: { type: String, required: true },
    at: { type: Date, default: Date.now },
    tools: [toolCallSchema],
    model: String,
    ms: Number, // time the assistant took to answer
  },
  { _id: false },
);

const assistantChatSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    title: { type: String, default: 'New conversation' },
    messages: [messageSchema],
    messageCount: { type: Number, default: 0 },
    lastMessageAt: Date,
  },
  { timestamps: true },
);

assistantChatSchema.index({ hotel: 1, user: 1, lastMessageAt: -1 });
assistantChatSchema.index({ hotel: 1, lastMessageAt: -1 });

export const AssistantChat = mongoose.model('AssistantChat', assistantChatSchema);
