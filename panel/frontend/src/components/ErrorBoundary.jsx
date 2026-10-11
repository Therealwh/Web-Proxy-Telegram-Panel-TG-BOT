// Граница ошибок: ловит краш рендера одной страницы и НЕ гасит всё SPA.
// Нужна потому, что раньше падение /engine оставляло пустым весь интерфейс —
// включая меню, по которому нельзя было уйти на другую страницу.
import React from 'react';
import ErrorCard from './ErrorCard';

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
        this.handleReset = this.handleReset.bind(this);
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // В консоль: подробности нужны при разборе, в карточке их мало
        console.error('[ui] Ошибка рендера:', error, info?.componentStack);
    }

    handleReset() {
        this.setState({ error: null });
    }

    render() {
        if (this.state.error) {
            return <ErrorCard error={this.state.error} onReset={this.handleReset} />;
        }
        return this.props.children;
    }
}