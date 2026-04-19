# Sales Analysis

Explore regional sales data using Arquero and Observable Plot.

```js
var data = aq.from([
  { category: "A", value: 10, region: "North" },
  { category: "B", value: 25, region: "South" },
  { category: "C", value: 15, region: "North" },
  { category: "D", value: 30, region: "East"  },
  { category: "E", value: 18, region: "West"  },
  { category: "F", value: 5, region: "South"  }
])

display(data)
```

## Summary by Region

```js
var summary = data
  .groupby("region")
  .rollup({ total: aq.op.sum("value") })
  .orderby("region")

display(summary)
```

## Visualization

```js
var chart = Plot.plot({
  marginLeft: 50,
  style: { background: "transparent", color: "#cdd6f4", fontSize: "12px" },
  marks: [
    Plot.barY(data.objects(), { x: "category", y: "value", fill: "region" }),
    Plot.ruleY([0]),
  ],
})

displayPlot(chart)
```
