export const TMWYA_TOOL = {
  functionDeclarations: [
    {
      name: "log_nutrition_intake",
      description: "Logs a list of food items to the user's nutrition database",
      parameters: {
        type: "OBJECT",
        properties: {
          items: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "Unstructured list of foods, e.g., ['4 eggs','10oz ribeye']",
          },
        },
        required: ["items"],
      },
    },
  ],
};
