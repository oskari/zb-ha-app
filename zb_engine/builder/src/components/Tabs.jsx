import PropTypes from 'prop-types';

/**
 * Reusable tabs component for left and right panels.
 *
 * @param {Object} props
 * @param {string[]} props.tabs - Array of tab names
 * @param {string} props.activeTab - Currently active tab
 * @param {(tab: string) => void} props.onTabChange - Callback when tab is clicked
 */
export default function Tabs({ tabs, activeTab, onTabChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          className={`tab ${tab === activeTab ? 'active' : ''}`}
          onClick={() => onTabChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

Tabs.propTypes = {
  tabs: PropTypes.arrayOf(PropTypes.string).isRequired,
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
};
