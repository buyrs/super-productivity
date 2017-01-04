/**
 * @ngdoc directive
 * @name superProductivity.directive:editOnClick
 * @description
 * # editOnClick
 */

(function () {
  'use strict';

  angular
    .module('superProductivity')
    .directive('editOnClick', editOnClick);

  /* @ngInject */
  function editOnClick() {
    return {
      templateUrl: 'scripts/edit-on-click/edit-on-click-d.html',
      bindToController: true,
      controller: EditOnClickCtrl,
      controllerAs: 'vm',
      restrict: 'A',
      scope: {
        editOnClick: '=',
        editOnClickToggle: '='
      }
    };
  }

  /* @ngInject */
  function EditOnClickCtrl($element, $scope, $timeout) {
    let vm = this;
    let inputEl = $element.find('input');

    vm.toggleShowEdit = () => {
      vm.showEdit = true;
      $timeout(function () {
        inputEl[0].focus();
      });
    };

    $scope.$watch('vm.editOnClickToggle', (mVal) => {
      if (mVal && mVal[0]) {
        vm.toggleShowEdit();
        mVal[0] = false;
      }
    });
  }

})();
