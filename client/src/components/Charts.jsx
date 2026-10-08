import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function TopicAccuracyChart({ topics, color = "#32d6ff" }) {
  return (
    <ResponsiveContainer height={220} width="100%">
      <BarChart data={topics.length ? topics : [{ topic: "Play more", accuracy: 0 }]} layout="vertical" margin={{ left: 14, right: 18 }}>
        <CartesianGrid horizontal={false} stroke="#34436d" />
        <XAxis domain={[0, 100]} hide type="number" />
        <YAxis axisLine={false} dataKey="topic" tick={{ fill: "#9aa8c7", fontSize: 12 }} tickLine={false} type="category" width={110} />
        <Tooltip contentStyle={{ background: "#141d3b", border: "1px solid #34436d", borderRadius: 8, color: "#f5f7ff" }} formatter={(value) => [`${value}%`, "Accuracy"]} />
        <Bar dataKey="accuracy" fill={color} radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function QuestionAccuracyChart({ questions, color = "#ff6b7a" }) {
  return (
    <ResponsiveContainer height={220} width="100%">
      <BarChart data={questions} layout="vertical" margin={{ left: 14, right: 18 }}>
        <CartesianGrid horizontal={false} stroke="#34436d" />
        <XAxis domain={[0, 100]} hide type="number" />
        <YAxis axisLine={false} dataKey="questionNumber" tick={{ fill: "#9aa8c7", fontSize: 12 }} tickFormatter={(value) => `Q${value}`} tickLine={false} type="category" width={34} />
        <Tooltip contentStyle={{ background: "#141d3b", border: "1px solid #34436d", borderRadius: 8, color: "#f5f7ff" }} formatter={(value) => [`${value}%`, "Accuracy"]} />
        <Bar dataKey="percentageCorrect" fill={color} radius={[0, 5, 5, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
