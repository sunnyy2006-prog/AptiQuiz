import "dotenv/config";
import database from "./db.js";

const questions = [
  ["What is 15% of 240?", ["24", "36", "40", "48"], 1, "quantitative", "easy"],
  ["A train travels 180 km in 3 hours. What is its speed?", ["45 km/h", "60 km/h", "75 km/h", "90 km/h"], 1, "quantitative", "easy"],
  ["If x + 7 = 19, what is x?", ["10", "11", "12", "13"], 2, "quantitative", "easy"],
  ["The ratio of boys to girls is 3:2. If there are 25 students, how many are girls?", ["8", "10", "12", "15"], 1, "quantitative", "easy"],
  ["What is the average of 12, 18, 20 and 30?", ["18", "20", "22", "24"], 1, "quantitative", "easy"],
  ["A product marked at ₹800 is sold at a 15% discount. What is its selling price?", ["₹660", "₹680", "₹700", "₹720"], 1, "quantitative", "easy"],
  ["If 5 workers finish a job in 12 days, how long would 10 workers take at the same rate?", ["4 days", "6 days", "8 days", "10 days"], 1, "quantitative", "medium"],
  ["What is the simple interest on ₹5,000 at 8% per year for 2 years?", ["₹400", "₹600", "₹800", "₹1,000"], 2, "quantitative", "easy"],
  ["A number increased by 20% becomes 360. What was the original number?", ["280", "300", "320", "340"], 1, "quantitative", "medium"],
  ["What is the next number in the sequence 2, 6, 12, 20, 30?", ["36", "40", "42", "44"], 2, "quantitative", "medium"],
  ["If all Bloops are Razzies and all Razzies are Lazzies, which statement must be true?", ["All Lazzies are Bloops", "All Bloops are Lazzies", "No Bloops are Lazzies", "Some Razzies are not Bloops"], 1, "logical", "easy"],
  ["Find the odd one out: 3, 5, 11, 14, 17.", ["3", "5", "14", "17"], 2, "logical", "easy"],
  ["Complete the analogy: Book is to Reading as Fork is to:", ["Writing", "Eating", "Cooking", "Cutting"], 1, "logical", "easy"],
  ["A clock shows 3:00. What is the angle between the hands?", ["0°", "45°", "90°", "180°"], 2, "logical", "easy"],
  ["If CAT is coded as DBU, how is DOG coded?", ["EPH", "EOG", "FPH", "DPH"], 0, "logical", "easy"],
  ["Ravi walks north, turns right, then turns right again. Which direction is he facing?", ["North", "South", "East", "West"], 1, "logical", "easy"],
  ["Which number replaces the question mark: 4, 9, 16, 25, ?", ["30", "32", "36", "49"], 2, "logical", "easy"],
  ["P is taller than Q. Q is taller than R. Who is shortest?", ["P", "Q", "R", "Cannot determine"], 2, "logical", "easy"],
  ["If today is Wednesday, what day will it be 45 days from today?", ["Friday", "Saturday", "Sunday", "Monday"], 1, "logical", "medium"],
  ["Five people sit in a row. Amit is left of Beena and right of Chirag. Who is between Chirag and Beena?", ["Amit", "Beena", "Chirag", "Cannot determine"], 0, "logical", "medium"],
  ["Choose the word closest in meaning to 'abundant'.", ["Rare", "Plentiful", "Tiny", "Accurate"], 1, "verbal", "easy"],
  ["Choose the opposite of 'mitigate'.", ["Reduce", "Soften", "Aggravate", "Explain"], 2, "verbal", "medium"],
  ["Identify the correctly spelled word.", ["Accomodate", "Acommodate", "Accommodate", "Acomodate"], 2, "verbal", "easy"],
  ["Complete the sentence: Neither the manager nor the assistants ___ available.", ["was", "were", "is", "has"], 1, "verbal", "medium"],
  ["What does the idiom 'break the ice' mean?", ["End a meeting", "Start a friendly conversation", "Make a mistake", "Feel cold"], 1, "verbal", "easy"],
  ["Choose the grammatically correct sentence.", ["She don't like tea.", "She doesn't likes tea.", "She doesn't like tea.", "She not like tea."], 2, "verbal", "easy"],
  ["Which word is a synonym for 'concise'?", ["Brief", "Confusing", "Loud", "Distant"], 0, "verbal", "easy"],
  ["Complete the analogy: Doctor : Hospital :: Teacher :", ["Library", "School", "Court", "Laboratory"], 1, "verbal", "easy"],
  ["Choose the best meaning of 'pragmatic'.", ["Idealistic", "Practical", "Emotional", "Careless"], 1, "verbal", "medium"],
  ["In the sentence 'The bright student solved the puzzle', which word is an adjective?", ["The", "bright", "student", "solved"], 1, "verbal", "easy"],
  ["A shop's quarterly sales are: Q1 ₹20 lakh, Q2 ₹25 lakh, Q3 ₹30 lakh, Q4 ₹35 lakh. What is the annual total?", ["₹100 lakh", "₹105 lakh", "₹110 lakh", "₹115 lakh"], 2, "data interpretation", "easy"],
  ["Using the same sales data, what is the percentage increase from Q1 to Q4?", ["50%", "60%", "75%", "80%"], 2, "data interpretation", "medium"],
  ["A class survey records tea 30 students, coffee 20, juice 10 and neither 5. How many students were surveyed?", ["55", "60", "65", "70"], 2, "data interpretation", "easy"],
  ["A company's employees by department are HR 12, Sales 28, Tech 40 and Finance 20. What percentage work in Tech?", ["30%", "35%", "40%", "45%"], 2, "data interpretation", "easy"],
  ["A car uses 8 litres for 120 km. How many litres will it use for 300 km?", ["16", "18", "20", "24"], 2, "data interpretation", "easy"],
  ["A pie chart gives a 90° sector to Mathematics. What fraction of students chose Mathematics?", ["1/2", "1/3", "1/4", "1/5"], 2, "data interpretation", "easy"],
  ["Monthly website visits are 10k, 15k, 12k and 18k. Which month has the second-highest visits?", ["Month 1", "Month 2", "Month 3", "Month 4"], 1, "data interpretation", "easy"],
  ["A table shows Product A: 40 sold at ₹50 and Product B: 30 sold at ₹80. What is total revenue?", ["₹3,200", "₹4,000", "₹4,400", "₹4,800"], 2, "data interpretation", "medium"],
  ["A school has 240 students. If 35% are in the science club, how many students is that?", ["72", "84", "96", "105"], 1, "data interpretation", "easy"],
  ["A factory produced 500, 600 and 750 units over three days. What was the average production?", ["600", "616.67", "625", "650"], 1, "data interpretation", "medium"]
];

export function seedDatabase() {
  return database.transaction(() => {
    const college = database.prepare("INSERT OR IGNORE INTO colleges (name) VALUES (?)").run("AptiQuiz Sample College");
    const collegeId = college.lastInsertRowid || database.prepare("SELECT id FROM colleges WHERE name = ?").get("AptiQuiz Sample College").id;
    const setIds = new Map();
    for (const topic of ["quantitative", "logical", "verbal", "data interpretation"]) {
      const name = `${topic[0].toUpperCase()}${topic.slice(1)} Aptitude`;
      const result = database.prepare(`
        INSERT OR IGNORE INTO question_sets (name, description, college_id)
        VALUES (?, ?, ?)
      `).run(name, `Sample ${topic} questions`, collegeId);
      setIds.set(topic, result.lastInsertRowid || database.prepare("SELECT id FROM question_sets WHERE name = ?").get(name).id);
    }
    const count = database.prepare("SELECT COUNT(*) AS count FROM questions").get().count;
    if (count > 0) return count;
    const insert = database.prepare(`
      INSERT INTO questions
        (question_set_id, text, options, correct_index, topic, difficulty, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    questions.forEach(([text, options, correctIndex, topic, difficulty], index) => {
      insert.run(setIds.get(topic), text, JSON.stringify(options), correctIndex, topic, difficulty, index);
    });
    return questions.length;
  })();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(`Seed complete: ${seedDatabase()} questions available.`);
}
