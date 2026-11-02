import React from "react";

interface Props {
  word: string;
}

export const Word: React.FC<Props> = ({ word }) => (
  <span style={{ display: "inline-block", marginRight: "0.25em" }}>{word}</span>
);
