import React from 'react';
import { Navigate } from 'react-router-dom';

export default function MealLogPage() {
  // Redirect to chat with meal logging intent
  return <Navigate to="/chat" state={{ initialMessage: "I want to log a meal" }} replace />;
}


