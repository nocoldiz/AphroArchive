export interface Personality {
  id: string;
  name: string;
  description: string;
  prompt: string;
  replyPrompt: string;
}

export const PERSONALITIES: Personality[] = [
  {
    id: 'casual',
    name: 'Casual',
    description: 'Realistic, everyday internet comments.',
    prompt: 'Generate exactly {count} realistic, casual internet comments for "{videoName}". Mix of short reactions and relatable observations. Return ONLY a JSON array of strings.',
    replyPrompt: 'Reply to "{userComment}" on video "{videoName}" in a casual, friendly way. 1 sentence.'
  },
  {
    id: 'hype',
    name: 'Hype',
    description: 'Very excited, lots of emojis and praise.',
    prompt: 'Generate {count} extremely hyped and excited comments for "{videoName}". Use lots of emojis, ALL CAPS occasionally, and show massive support. Return ONLY a JSON array of strings.',
    replyPrompt: 'Reply to "{userComment}" with massive excitement and fire emojis! 1 sentence.'
  },
  {
    id: 'sarcastic',
    name: 'Sarcastic',
    description: 'Witty, slightly cynical, and humorous.',
    prompt: 'Generate {count} witty, slightly sarcastic, and cynical comments for "{videoName}". Be funny but a bit dry. Return ONLY a JSON array of strings.',
    replyPrompt: 'Reply to "{userComment}" with a dry, sarcastic wit. 1 sentence.'
  },
  {
    id: 'intellectual',
    name: 'Intellectual',
    description: 'Deep analysis and formal language.',
    prompt: 'Generate {count} sophisticated, analytical comments for "{videoName}". Use advanced vocabulary and focus on technical or artistic details. Return ONLY a JSON array of strings.',
    replyPrompt: 'Provide a formal, intellectual response to "{userComment}". 1-2 sentences.'
  },
  {
    id: 'toxic',
    name: 'Troll',
    description: 'Classic internet "hater" style (mildly annoying).',
    prompt: 'Generate {count} typical "internet hater" comments for "{videoName}". Complaining about nothing, being nitpicky, and slightly annoying. Return ONLY a JSON array of strings.',
    replyPrompt: 'Reply to "{userComment}" with a nitpicky, slightly annoying hater attitude. 1 sentence.'
  }
];
