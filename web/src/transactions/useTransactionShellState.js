import { useState } from "react";

export function useTransactionShellState() {
  const [activeSection, setActiveSection] = useState("investment");
  const [selectedInvestmentOrderKey, setSelectedInvestmentOrderKey] = useState("");
  const [selectedInvestmentSearchItem, setSelectedInvestmentSearchItem] = useState(null);
  const [sortId, setSortId] = useState("valueAsc");
  const [sortOpen, setSortOpen] = useState(false);
  const [manualOrderEditing, setManualOrderEditing] = useState(false);
  const [manualOrderDraft, setManualOrderDraft] = useState([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [selectedAccountSeq, setSelectedAccountSeq] = useState("");

  return {
    activeSection, setActiveSection,
    selectedInvestmentOrderKey, setSelectedInvestmentOrderKey,
    selectedInvestmentSearchItem, setSelectedInvestmentSearchItem,
    sortId, setSortId,
    sortOpen, setSortOpen,
    manualOrderEditing, setManualOrderEditing,
    manualOrderDraft, setManualOrderDraft,
    accountOpen, setAccountOpen,
    selectedAccountSeq, setSelectedAccountSeq,
  };
}
