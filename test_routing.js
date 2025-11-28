// Test routing logic
const testMessages = [
  "tell me about the effects caffeine has on sleep patterns if I drink it too late",
  "for breakfast I ate 3 eggs, 2 slices of bacon and a coffee",
  "explain how protein helps muscle recovery",
  "log this: 200g chicken breast and 100g rice"
];

// Mock the semantic router (simplified simulation)
function mockDecideRoute(message) {
  const lower = message.toLowerCase();

  // Check for explicit logging patterns
  if (/\b(i\s+ate|i\s+had|log\s+(this|my\s+meal|that)|add\s+(this|my\s+meal)|for\s+(breakfast|lunch|dinner)\s+i\s+ate)\b/i.test(lower)) {
    return { route: 'food_log', confidence: 'high' };
  }

  // Check for food questions vs general questions
  if (/\b(what are the macros|protein in|calories in)\b/i.test(lower)) {
    return { route: 'food_question', confidence: 'high' };
  }

  // Default to AMA for questions
  if (/\b(what|how|why|tell me|explain)\b/i.test(lower)) {
    return { route: 'AMA', confidence: 'high' };
  }

  return { route: 'general', confidence: 'low' };
}

console.log('Testing routing logic:\n');

testMessages.forEach((msg, i) => {
  const routeDecision = mockDecideRoute(msg);
  const intent = routeDecision.route === 'food_log' ? 'meal_logging' : 'ama';

  console.log(`Test ${i+1}: "${msg.substring(0, 50)}..."`);
  console.log(`  route: ${routeDecision.route}`);
  console.log(`  reason: ${intent === 'meal_logging' ? 'log intent' : 'general question'}`);
  console.log(`  confidence: ${routeDecision.confidence}`);
  console.log('');
});

