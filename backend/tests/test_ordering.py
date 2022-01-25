import pytest

from app.services.ordering import (
    MIN_GAP,
    STEP,
    UnknownNeighbour,
    append_position,
    clamp_index,
    evenly_spaced,
    gap_too_small,
    needs_normalising,
    plan_move,
    position_between,
    resolve_index,
)


def apply(positions: list[float], index: int) -> list[float]:
    """Insert according to plan_move and return the resulting column (moved item included)."""
    plan = plan_move(positions, index)
    if plan.rebalanced is not None:
        return list(plan.rebalanced)
    return [*positions[: plan.index], plan.position, *positions[plan.index :]]


def is_strictly_increasing(values: list[float]) -> bool:
    return all(a < b for a, b in zip(values, values[1:], strict=False))


class TestEvenlySpaced:
    def test_starts_at_one_step(self):
        assert evenly_spaced(3) == [STEP, 2 * STEP, 3 * STEP]

    def test_empty(self):
        assert evenly_spaced(0) == []

    def test_custom_step(self):
        assert evenly_spaced(2, step=10) == [10, 20]


class TestAppendPosition:
    def test_empty_column(self):
        assert append_position([]) == STEP

    def test_after_the_largest_even_if_unsorted(self):
        assert append_position([3.0, 1.0, 2.0]) == 3.0 + STEP


class TestPositionBetween:
    def test_empty_column(self):
        assert position_between(None, None) == STEP

    def test_midpoint(self):
        assert position_between(1024, 2048) == 1536

    def test_bottom_of_column(self):
        assert position_between(2048, None) == 2048 + STEP

    def test_top_of_column_steps_down_when_there_is_room(self):
        assert position_between(None, 4096) == 4096 - STEP

    def test_top_of_column_halves_small_positions_to_stay_positive(self):
        assert position_between(None, 100) == 50
        assert position_between(None, 100) > 0

    def test_result_is_strictly_between_neighbours(self):
        for upper, lower in [(1.0, 2.0), (0.5, 0.75), (1000.0, 1000.5)]:
            assert upper < position_between(upper, lower) < lower


class TestGapTooSmall:
    def test_normal_gap(self):
        assert not gap_too_small(1.0, 2.0)

    def test_tiny_gap(self):
        assert gap_too_small(1.0, 1.0 + MIN_GAP / 2)

    def test_equal_positions(self):
        assert gap_too_small(5.0, 5.0)

    def test_appending_always_has_room(self):
        assert not gap_too_small(1e9, None)
        assert not gap_too_small(None, None)

    def test_top_edge_with_tiny_first_position(self):
        assert gap_too_small(None, MIN_GAP / 10)
        assert not gap_too_small(None, 1.0)


class TestNeedsNormalising:
    def test_well_spaced(self):
        assert not needs_normalising([1.0, 2.0, 3.0])

    def test_duplicates(self):
        assert needs_normalising([1.0, 2.0, 2.0])

    def test_unsorted(self):
        assert needs_normalising([2.0, 1.0])

    def test_trivial_columns(self):
        assert not needs_normalising([])
        assert not needs_normalising([7.0])


class TestPlanMove:
    def test_into_empty_column(self):
        plan = plan_move([], 0)
        assert plan.position == STEP
        assert plan.rebalanced is None

    def test_to_top(self):
        assert apply([1024.0, 2048.0], 0)[0] < 1024.0

    def test_to_middle(self):
        plan = plan_move([1024.0, 2048.0], 1)
        assert plan.position == 1536.0
        assert plan.index == 1

    def test_to_bottom(self):
        assert plan_move([1024.0, 2048.0], 2).position == 2048.0 + STEP

    def test_index_is_clamped(self):
        assert plan_move([1024.0], 99).index == 1
        assert plan_move([1024.0], -5).index == 0

    def test_only_the_moved_item_changes_normally(self):
        assert plan_move([1.0, 2.0, 3.0], 1).rebalanced is None

    def test_rebalances_when_gap_is_exhausted(self):
        plan = plan_move([1.0, 1.0 + MIN_GAP / 4, 5.0], 1)
        assert plan.rebalanced == (STEP, 2 * STEP, 3 * STEP, 4 * STEP)
        assert plan.position == 2 * STEP

    def test_rebalances_when_column_already_has_duplicates(self):
        plan = plan_move([10.0, 10.0, 20.0], 3)
        assert plan.rebalanced is not None
        assert len(plan.rebalanced) == 4

    def test_rebalanced_position_matches_index(self):
        plan = plan_move([3.0, 3.0], 0)
        assert plan.rebalanced[plan.index] == plan.position

    def test_repeated_inserts_at_same_spot_stay_ordered(self):
        """Dropping into the same gap many times eventually rebalances and never breaks the order."""
        column = [STEP, 2 * STEP]
        rebalances = 0
        for _ in range(200):
            plan = plan_move(column, 1)
            rebalances += plan.rebalanced is not None
            column = apply(column, 1)
            assert is_strictly_increasing(column)
        assert rebalances >= 1
        assert len(column) == 202

    def test_repeated_inserts_at_top_stay_positive_and_ordered(self):
        column = [STEP]
        for _ in range(100):
            column = apply(column, 0)
            assert column[0] > 0
            assert is_strictly_increasing(column)


class TestResolveIndex:
    ids = [10, 20, 30]

    def test_after_neighbour(self):
        assert resolve_index(self.ids, after_id=20) == 2

    def test_before_neighbour(self):
        assert resolve_index(self.ids, before_id=20) == 1

    def test_after_wins_over_before(self):
        assert resolve_index(self.ids, after_id=10, before_id=30) == 1

    def test_before_first_is_top(self):
        assert resolve_index(self.ids, before_id=10) == 0

    def test_after_last_is_bottom(self):
        assert resolve_index(self.ids, after_id=30) == 3

    def test_explicit_index_is_clamped(self):
        assert resolve_index(self.ids, index=1) == 1
        assert resolve_index(self.ids, index=50) == 3

    def test_default_is_end(self):
        assert resolve_index(self.ids) == 3
        assert resolve_index([]) == 0

    @pytest.mark.parametrize("kwargs", [{"after_id": 99}, {"before_id": 99}])
    def test_unknown_neighbour(self, kwargs):
        with pytest.raises(UnknownNeighbour):
            resolve_index(self.ids, **kwargs)


def test_clamp_index():
    assert clamp_index(-1, 3) == 0
    assert clamp_index(2, 3) == 2
    assert clamp_index(4, 3) == 3
