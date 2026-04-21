export const AFFIRMATIONS = [
  "You're a small human with medium-sized dust-busting powers. Respectable.",
  "Somewhere a forgotten sock is whispering your name with reverence.",
  "Scrubbing builds character. Also clean countertops.",
  "The laundry fairy called. She says you're ruining her business.",
  "You are 87% magic, 12% vinegar, 1% glitter.",
  "Today, even the refrigerator is proud of you.",
  "You could clean a castle. With one hand. Probably.",
  "Fresh sheets. Fresh start. Fresh you.",
  "Tiny tasks, enormous human. You got this.",
  "The universe saw you wipe that counter. It is pleased.",
  "You turn chaos into sparkle. That's basically witchcraft, and it's legal.",
  "Somewhere, a Roomba is writing sonnets about you.",
  "Mop swishes sound better in your hands.",
  "Your energy today is 10/10 swiffer-core.",
  "You are the soft launch of a beautiful Thursday.",
  "Cleaning team MVP: you. Every time.",
  "You make chores look like a Pixar training montage.",
  "Dust bunnies fear you. Respect that privilege.",
  "Big 'I finished the list' energy loading…",
  "Your smile is a free hug for the house.",
  "A toilet brush in your hand is basically a scepter.",
  "Even the plants are clapping right now.",
  "You're doing one thing, and that one thing is enough.",
  "This is your villain origin story — if the villain is SPOTLESS.",
  "Tomorrow-you is going to high-five today-you so hard.",
  "You sparkle on purpose. Also the faucet now does too.",
  "The vacuum is a friend. The vacuum has always been a friend.",
  "Be gentle with yourself. The bathtub is the one that's dirty, not you.",
  "Plot twist: you're the main character AND the janitor AND the hero.",
  "Breathe in. Breathe out. Spray. Wipe. Legend.",
];

export const PIKACHU_QUOTES = [
  "Time flies like an arrow. Fruit flies like a banana.",
  "Never gonna give you up. Never gonna let you down.",
  "I used to be an adventurer, then I took a broom to the knee.",
  "Pika pika! (That's legally binding.)",
  "Why did the scarecrow win an award? He was outstanding in his field.",
  "I'm not a regular Pokémon, I'm a COOL Pokémon.",
  "If I had a dollar for every lost sock, I'd have zero dollars. Pockets also lost.",
  "Chaotic good. Also chaotic tail.",
  "Is this the Krusty Krab? No, this is Patrick.",
  "My favorite season is cleaning season. (That's a lie. It's snack.)",
  "In my humble opinion, I am the humblest Pokémon.",
  "Pikaboo!",
  "One does not simply walk into Mordor. One Pikachu-dashes.",
  "I came here to chew bubblegum and bolt surfaces. I'm all out of bubblegum.",
  "Life is short. Pikachu is shorter.",
  "Beware the cheese. All cheese is a trap.",
  "I dream in thunderbolts and dryer sheets.",
  "99 problems and a mop ain't one.",
  "I'm not short. I'm concentrated awesome.",
  "Plot twist: the dirt was inside us all along. Nope — it's on the floor.",
  "I told a joke about dust. It didn't land. It just settled.",
  "If I fits, I zaps.",
  "Warning: may contain traces of glitter and mild thunder.",
  "Today's forecast: 100% chance of Pika.",
  "I'm on a seafood diet. I see food, I zap food.",
];

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const diff = d.getTime() - start;
  return Math.floor(diff / 86_400_000);
}
