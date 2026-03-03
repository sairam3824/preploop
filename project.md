Project Goal
Build a gamified daily interview practice web application where:
User gets 1–2 questions per day
User submits answer
OpenAI evaluates + guides in real-time
If user gives up → show model answer
Track progress, streaks, and scores
Admin panel to manage topics & questions
Backend: Supabase email authenticated.
Deployment: Vercel
AI: OpenAI API

Core Features
Daily Question System
User receives 1 or 2 questions per day
Questions are selected from database
Once attempted → locked for that day
Next unlock at midnight (user timezone)
i need an dedicated path for the chat direct apis may disturb the flow and context.
History of chats are to be saved.

AI-Powered Evaluation (OpenAI)
When user submits answer:
OpenAI should:
Evaluate correctness
Score from 1–10
Highlight strengths
Identify missing points
Suggest improvements
Guide with hints (without revealing full answer immediately)
If user clicks:
"I Give Up"
Then:
Show ideal structured answer
Show comparison between user answer & ideal answer
Explain gaps

Gamification System 🎮
Add:
Daily streak counter
XP points
Levels (Beginner → Pro → Expert)
Progress bar per topic
Consistency badge
Accuracy percentage
Performance history graph
XP Adder, for every question answers correctely we get 10 points as per question difficulty we get more points
and if openai giving hints then we need to reduce the points. 

Admin Panel Requirements
Admin Features:
Dashboard:
Total questions
Total users
Average score
Add Topic
Add Question
Edit / Delete Questions
Mark question difficulty
Bulk upload (optional future) - word or excel or pdf 
if anything was needed please add 