import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact } from "../lib/api.js";
import { useReducedMotion } from "motion/react";

const palette = [
  "rgb(var(--accent))",
  "rgb(var(--accent) / 0.82)",
  "rgb(var(--accent) / 0.66)",
  "rgb(var(--accent) / 0.5)",
  "rgb(var(--accent) / 0.38)",
  "rgb(var(--accent) / 0.28)",
  "rgb(var(--accent) / 0.18)",
];

const tooltipStyle = {
  backgroundColor: "rgb(var(--card))",
  border: "1px solid rgb(var(--border))",
  borderRadius: "12px",
  color: "rgb(var(--foreground))",
  boxShadow: "0 18px 45px rgb(30 54 44 / 0.16)",
  backdropFilter: "blur(12px)",
};

const tooltipLabelStyle = { color: "rgb(var(--foreground))", fontWeight: 600 };
const tooltipItemStyle = { color: "rgb(var(--foreground))" };

export function TokenAreaChart({ data, onSelect }) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart
        data={data}
        onClick={(state) => state?.activeLabel && onSelect?.(state.activeLabel)}
      >
        <defs>
          <linearGradient id="tokenArea" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor="rgb(var(--accent))"
              stopOpacity={0.45}
            />
            <stop
              offset="100%"
              stopColor="rgb(var(--accent))"
              stopOpacity={0.02}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          stroke="rgb(var(--border))"
          strokeOpacity={0.7}
          vertical={false}
        />
        <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickFormatter={formatCompact}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <Tooltip
          formatter={(value) => formatCompact(value)}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={{
            stroke: "rgb(var(--accent))",
            strokeOpacity: 0.35,
            strokeWidth: 1,
          }}
        />
        <Area
          isAnimationActive={!reduce}
          type="monotone"
          dataKey="tokens"
          stroke="rgb(var(--accent))"
          fill="url(#tokenArea)"
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          animationDuration={350}
          activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--card))" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ProjectBarChart({ data, onSelect }) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} layout="vertical" margin={{ left: 16, right: 24 }}>
        <CartesianGrid
          stroke="rgb(var(--border))"
          strokeOpacity={0.7}
          horizontal={false}
        />
        <XAxis
          type="number"
          tickFormatter={formatCompact}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tickLine={false}
          axisLine={false}
          fontSize={12}
        />
        <Tooltip
          formatter={(value) => formatCompact(value)}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={{ fill: "rgb(var(--accent) / 0.08)" }}
        />
        <Bar
          isAnimationActive={!reduce}
          onClick={(row) => onSelect?.(row.id)}
          dataKey="tokens"
          radius={[0, 5, 5, 0]}
          animationDuration={350}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={palette[index % palette.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ModelPieChart({ data, onSelect }) {
  const reduce = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          isAnimationActive={!reduce}
          onClick={(row) => onSelect?.(row.model)}
          data={data}
          dataKey="tokens"
          nameKey="model"
          innerRadius={62}
          outerRadius={94}
          paddingAngle={2}
          cornerRadius={3}
          stroke="rgb(var(--card))"
          strokeWidth={2}
          animationDuration={350}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={palette[index % palette.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatCompact(value)}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
