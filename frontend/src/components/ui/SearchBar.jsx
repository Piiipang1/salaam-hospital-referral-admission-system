import { Search } from 'lucide-react';
import './SearchBar.css';

const SearchBar = ({ value, onChange, placeholder = 'Search...', id }) => (
  <div className="search-bar">
    <span className="search-bar__icon" aria-hidden="true"><Search size={14} /></span>
    <input
      id={id}
      type="search"
      className="search-bar__input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
    />
  </div>
);

export default SearchBar;
