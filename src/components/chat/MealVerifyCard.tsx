import React from "react";

import type { MealVerifyCard } from "@/types/uiPayload";

type Props = { card: MealVerifyCard; onAction: (id: "log"|"edit"|"done"|"cancel")=>void; };

export default function MealVerifyCardView({ card, onAction }: Props){

  return (

    <div className="rounded-2xl border p-3 shadow-sm">

      <div className="font-semibold mb-2">

        {card.mode === "log" ? "Review & log meal" : "Nutrition details"}

      </div>

      <ul className="space-y-1">

        {card.items.map((it,idx)=>(

          <li key={idx} className="flex justify-between">

            <span>{it.name} {it.portion_qty} {it.portion_unit}</span>

            <span className="text-sm opacity-80">{it.calories ? `${it.calories} kcal` : ""}</span>

          </li>

        ))}

      </ul>

      <div className="mt-3 flex gap-2">

        {card.actions.map(a=>(

          <button key={a.id} onClick={()=>onAction(a.id)} className="px-3 py-1 rounded-xl border">

            {a.label}

          </button>

        ))}

      </div>

    </div>

  );

}
